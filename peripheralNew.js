/**
 * Created by London on 8/3/17.
 *
 * bleno is Copyright (c) 2013 Sandeep Mistry and is used under the permission of
 * The MIT License, as stated below.
 *
 * The MIT License (MIT)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

'use strict'

const bleno = require('bleno');
const uuids = require('./uuids');
var util = require('util');
const STATUS = uuids.STATUS;
const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();
var indicateQ = [];
var outstandingIndications = 0;
const maxQLength = 1000000;
const chunkSize = 19;
var state = '';
var writeValue = '';
var serviceResetRetries = 3;
var connType = {};
var devInfo = {};

class ReadIndicateChar extends bleno.Characteristic {
    constructor(uuid) {
        super({
            uuid: uuid,
            properties: ['read', 'indicate']
        });
        this.val = {};
        this.updateValueCallback = null;
        this.readQ = [];
    }

    onReadRequest(offset, callback) {
        if (this.readQ.length === 0) {
            let data = new Buffer(JSON.stringify(this.val));
            let length = data.byteLength;
            if (Math.ceil(length/chunkSize) > maxQLength) myEmitter.emit('error', new Error('Read too big'));
            for (var start = 0, end = chunkSize; start < length; start += chunkSize, end += chunkSize) {
                let status = new Buffer(1);
                status.writeUInt8(STATUS.READ | ((start + chunkSize >= length) ? STATUS.EOT : 0x00));
                let chunk = Buffer.concat([status, data.slice(start, Math.min(length, end))]);
                this.readQ.push(chunk);
            }
        }
        callback(this.RESULT_SUCCESS, this.readQ.shift());
    }

    onSubscribe(maxValueSize, updateValueCallback) {
        this.updateValueCallback = updateValueCallback;
    }

    onUnsubscribe() {
        this.updateValueCallback = null;
    };

    onIndicate() {
        outstandingIndications--;
        if(indicateQ.length > 0) {
            let obj = indicateQ.shift();
            obj.characteristic.sendIndication(obj.data, obj.resolve, obj.reject);
            outstandingIndications++;
        }
    };

    indicate(resolve, reject) {
        let data = Buffer(JSON.stringify(this.val));
        let length = data.byteLength;
        if (indicateQ.length + Math.ceil(length/chunkSize) > maxQLength) reject(new Error('Indicate queue full'));
        for (var start = 0, end = chunkSize; start < length; start += chunkSize, end += chunkSize) {
            let status = new Buffer(1);
            let endOfTransmission = (start + chunkSize >= length);
            status.writeUInt8(STATUS.INDICATE | (endOfTransmission ? STATUS.EOT : 0x00));
            let chunk = Buffer.concat([status, data.slice(start, Math.min(length, end))]);
            indicateQ.push({
                characteristic: this,
                data: chunk,
                resolve: endOfTransmission ? resolve : null,
                reject: reject
            });
        }
        if(outstandingIndications === 0 && indicateQ.length > 0) {
            let obj = indicateQ.shift();
            obj.characteristic.sendIndication(obj.data, obj.resolve, obj.reject);
            outstandingIndications++;
        }
    };

    sendIndication(data, resolve, reject) {
        if (this.updateValueCallback) {
            setImmediate(() => {
                this.updateValueCallback(data);
                if (resolve) resolve();
            });
        } else reject(new Error('Indicate failed'));
    };

    setValue(obj) {
        this.val = obj;
    };
}

const commandChar = new bleno.Characteristic({
    uuid: uuids.COMMAND_CHAR,
    properties: ['write'],
    onWriteRequest: function(data, offset, withoutResponse, callback) {
        if(data.byteLength > 0) {
            writeValue += data.toString('utf-8');
        } else {
            try {
                myEmitter.emit('received', JSON.parse(writeValue));
            } catch(err) {
                myEmitter.emit('error', new Error(err));
            }
            writeValue = '';
        }
        callback(this.RESULT_SUCCESS);
    }
});
const connTypeChar = new ReadIndicateChar(uuids.CONN_TYPE_CHAR);
const devInfoChar = new ReadIndicateChar(uuids.DEV_INFO_CHAR);
const services = [
    new bleno.PrimaryService({
        uuid : uuids.RENTLY_SERVICE,
        characteristics : [commandChar, connTypeChar, devInfoChar]
    })
];

bleno.on('stateChange', (blenoState) => {
    /*
     bleno states:   'unknown', 'resetting', 'unsupported',
     'unauthorized', 'poweredOff', 'poweredOn'
     */
    state = blenoState;
    myEmitter.emit('stateChange', state);
    if (state !== 'poweredOn') {
        stopAdvertising();
    }
});

bleno.on('accept', (clientAddress) => {
    console.log('\nAccepted connection from address', clientAddress);
    myEmitter.emit('connect', clientAddress);
});

bleno.on('disconnect', (clientAddress) => {
    console.log('\nDisconnected from address', clientAddress);
    myEmitter.emit('disconnect', clientAddress);
    //stopAdvertising().then(startAdvertising);
});

bleno.on('rssiUpdate', (rssi) => {
    myEmitter.emit('rssiUpdate', rssi);
});

bleno.on('servicesSetError', (err) => {
    stopAdvertising();
    if(serviceResetRetries > 0) {
        startAdvertising();
        serviceResetRetries -= 1;
    } else {
        myEmitter.emit(new Error(err));
    }
});

function startAdvertising() {
    return new Promise((resolve, reject) => {
        if (state === 'poweredOn') {
            bleno.startAdvertising('Rently', [uuids.RENTLY_SERVICE], (err) => {
                if(!err) {
                    bleno.setServices(services);
                    console.log('\nAdvertising...');
                    resolve();
                } else {
                    reject(new Error('Failed to start advertising'));
                }
            });
        } else {
            reject(new Error('Not in powered on state'));
        }
    });

}

function stopAdvertising() {
    return new Promise((resolve) => {
        bleno.stopAdvertising(() => {
            console.log('\nAdvertising stopped.');
            return resolve();
        });
    });
}

function on(event, callback) {
    /**
     * Events:
     * 'stateChange', 'connect', 'disconnect', 'received',
     * 'rssiUpdate', 'servicesSetError'
     */
    myEmitter.on(event, callback);
    return module.exports;
}

function once(event, callback) {
    myEmitter.once(event, callback);
    return module.exports;
}

function indicate(uuid) {
    return new Promise((resolve, reject) => {
        switch(uuid) {
            case uuids.CONN_TYPE_CHAR:
                connTypeChar.indicate(resolve, reject);
                break;
            case uuids.DEV_INFO_CHAR:
                devInfoChar.indicate(resolve, reject);
                break;
            default:
                myEmitter.emit('error', new Error('Failed to indicate uuid ' + uuid));
        }
    });
}

function setConnType(obj) {
    connTypeChar.setValue(obj);
    connType = obj;
}

function setDevInfo(obj) {
    devInfoChar.setValue(obj);
    devInfo = obj;
}

module.exports.startAdvertising = startAdvertising;
module.exports.stopAdvertising = stopAdvertising;
module.exports.on = on;
module.exports.once = once;
module.exports.indicate = indicate;
module.exports.setConnType = setConnType;
module.exports.setDevInfo = setDevInfo;