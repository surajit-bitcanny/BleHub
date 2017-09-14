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
const STATUS = uuids.STATUS;
const EventEmitter = require('events');
const Promise = require('bluebird');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();
var indicateQ = [];
var outstandingIndications = 0;
const maxQLength = 1000000;
const chunkSize = 19;
var state = '';
var writeValue = '';
var serviceSetRetries = 3;
var connType = {};
var devInfo = {};
var connected = false;
const TIMEOUT = 5000;
var writeTimeoutHandler = null;

class MyChar extends bleno.Characteristic {
    constructor(uuid, properties) {
        super({
            uuid: uuid,
            properties: properties
        });
        this.val = {};
        this.updateValueCallback = null;
        this.readQ = [];
    }

    onWriteRequest(data, offset, withoutResponse, callback) {
        writeRequestHandler(data, offset, withoutResponse, callback);
    }

    onReadRequest(offset, callback) {
        if (this.readQ.length === 0) {
            let data = new Buffer(JSON.stringify(this.val));
            let length = data.byteLength;

            if (Math.ceil(length/chunkSize) > maxQLength) {
                myEmitter.emit('error', new Error('Read too big'));
            }

            for (let start = 0, end = chunkSize;
                 start < length;
                 start += chunkSize, end += chunkSize)
            {
                let status = new Buffer(1);

                status.writeUInt8(
                    STATUS.READ |
                    ((start + chunkSize >= length) ? STATUS.EOT : 0x00)
                );

                let chunk = Buffer.concat([
                    status,
                    data.slice(start, Math.min(length, end))
                ]);

                this.readQ.push(chunk);
            }
        }

        callback(bleno.Characteristic.RESULT_SUCCESS, this.readQ.shift());
    }

    onSubscribe(maxValueSize, updateValueCallback) {
        this.updateValueCallback = updateValueCallback;
    }

    onUnsubscribe() {
        this.updateValueCallback = null;
    };

    onIndicate() {
        onIndicateHandler();
    };

    setValue(obj) {
        this.val = obj;
    };

    getValue() {
        return this.val;
    }
}

const characteristics = [
    new MyChar(uuids.COMMAND_CHAR, ['write', 'indicate']),
    new MyChar(uuids.CONN_TYPE_CHAR, ['read', 'indicate']),
    new MyChar(uuids.DEV_INFO_CHAR, ['read', 'indicate']),
    new MyChar(uuids.DEV_STATUS_CHAR, ['read', 'indicate'])
];
const services = [
    new bleno.PrimaryService({
        uuid: uuids.RENTLY_SERVICE,
        characteristics: characteristics
    })
];

bleno.on('stateChange', stateChangeHandler);
bleno.on('accept', acceptHandler);
bleno.on('disconnect', disconnectHandler);
bleno.on('servicesSetError', servicesSetErrorHandler);

function startAdvertising() {
    return new Promise((resolve, reject) => {
        if (state === 'poweredOn') {
            bleno.startAdvertising('Rently', [uuids.RENTLY_SERVICE], (err) => {
                if (!err) {
                    bleno.setServices(services);
                    console.log('\nAdvertising...');
                    return resolve();
                } else {
                    return reject(new Error('Failed to start advertising'));
                }
            });
        } else {
            return reject(new Error('Not in powered on state'));
        }
    });

}

function stopAdvertising() {
    return new Promise((resolve) => {
        bleno.stopAdvertising(() => {
            console.log('\nAdvertising stopped.');
            serviceSetRetries = 3;

            return resolve();
        });
    });
}

function disconnect() {
    bleno.disconnect();
    return Promise.resolve();
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

function removeAllListeners() {
    myEmitter.removeAllListeners();
}

function indicate(uuid, obj) {
    return new Promise((resolve, reject) => {

        let characteristic = getCharacteristic(uuid);

        if (!characteristic) {
            return reject(new Error('Failed to indicate ' + uuid));
        }

        let data = new Buffer(JSON.stringify(obj ? obj : characteristic.getValue()));
        let length = data.byteLength;

        if (indicateQ.length + Math.ceil(length/chunkSize) > maxQLength){
            reject(new Error('Indicate queue full'));
        }

        for (let start = 0, end = chunkSize;
             start < length;
             start += chunkSize, end += chunkSize)
        {
            let status = new Buffer(1);
            let endOfTransmission = (start + chunkSize >= length);

            status.writeUInt8(
                STATUS.INDICATE |
                (endOfTransmission ? STATUS.EOT : 0x00)
            );

            let chunk = Buffer.concat([
                status,
                data.slice(start, Math.min(length, end))
            ]);

            indicateQ.push({
                characteristic: characteristic,
                data: chunk,
                resolve: endOfTransmission ? resolve : null,
                reject: reject
            });
        }

        if(outstandingIndications === 0 && indicateQ.length > 0) {
            let obj = indicateQ.shift();

            sendIndication(
                obj.characteristic,
                obj.data,
                obj.resolve,
                obj.reject
            );

            outstandingIndications++;
        }
    });
}

function setCharacteristicValue(uuid, obj) {
    let characterisitic = getCharacteristic(uuid);

    if (characterisitic) {
        characterisitic.setValue(obj);
    }
}

function getCharacteristic(uuid) {
    for (let i = 0; i < characteristics.length; i++) {
        if (characteristics[i].uuid === uuid) {
            return characteristics[i];
        }
    }

    return null;
}

function updateRssi() {
    return new Promise((resolve, reject) => {
        bleno.updateRssi((err, rssi) => {
            if (err) {
                return reject(err);
            } else {
                return resolve(rssi);
            }
        });
    });
}

function stateChangeHandler(blenoState) {
    /**
     * bleno states:
     * 'unknown', 'resetting', 'unsupported',
     * 'unauthorized', 'poweredOff', 'poweredOn'
     */

    state = blenoState;

    myEmitter.emit('stateChange', state);

    if (state !== 'poweredOn') {
        stopAdvertising();
    }
}

function acceptHandler(clientAddress) {
    console.log('\nAccepted connection from address ' + clientAddress);
    connected = true;
    myEmitter.emit('connect', clientAddress);
}


function disconnectHandler(clientAddress) {
    console.log('\nDisconnected from address ' + clientAddress);
    connected = false;
    myEmitter.emit('disconnect', clientAddress);
}

function servicesSetErrorHandler(err) {
    stopAdvertising();

    if(serviceSetRetries > 0) {
        startAdvertising();
        serviceSetRetries -= 1;
    } else {
        myEmitter.emit('error', err);
    }
}

function writeRequestHandler(data, offset, withoutResponse, callback) {
    let endOfTransmission = (data.byteLength === 0);

    if (endOfTransmission) {
        try {
            if (writeTimeoutHandler) {
                clearTimeout(writeTimeoutHandler);
            }

            myEmitter.emit('received', JSON.parse(writeValue));

            indicate(uuids.COMMAND_CHAR, 'ACK');
        } catch(err) {
            myEmitter.emit('error', err.message);
        }

        writeValue = '';
    } else {
        if (writeTimeoutHandler) {
            clearTimeout(writeTimeoutHandler);
        }

        writeTimeoutHandler = setTimeout(() => {
            myEmitter.emit('error', 'Write timed out');
            writeValue = '';
        }, TIMEOUT);

        writeValue += data.toString('utf-8');
    }

    callback(bleno.Characteristic.RESULT_SUCCESS);
}

function isConnected() {
    return connected;
}

function onIndicateHandler() {
    outstandingIndications--;

    if(indicateQ.length > 0) {
        let obj = indicateQ.shift();

        sendIndication(
            obj.characteristic,
            obj.data,
            obj.resolve,
            obj.reject
        );

        outstandingIndications++;
    }
}

function sendIndication(characteristic, data, resolve, reject) {
    if (characteristic.updateValueCallback) {
        setImmediate(() => {
            characteristic.updateValueCallback(data);

            if (resolve) {
                return resolve();
            }
        });
    } else {
        return reject(new Error('Failed to indicate'));
    }
}

module.exports.startAdvertising = startAdvertising;
module.exports.stopAdvertising = stopAdvertising;
module.exports.on = on;
module.exports.once = once;
module.exports.removeAllListeners = removeAllListeners;
module.exports.indicate = indicate;
module.exports.updateRssi = updateRssi;
module.exports.disconnect = disconnect;
module.exports.isConnected = isConnected;
module.exports.setCharacteristicValue = setCharacteristicValue;
