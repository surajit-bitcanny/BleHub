/**
 * Created by London on 8/3/17.
 *
 * noble is Copyright (c) 2013 Sandeep Mistry and is used under the permission of
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

const noble = require('noble');
const uuids = require('./uuids');
const STATUS = uuids.STATUS;
const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();
const maxQLength = 1000000;
const chunkSize = 19;
var peripherals = [];
var commandChar = null;
var connTypeChar = null;
var devInfoChar = null;
var state = '';
var indicateValues = [];
var readValues = [];

noble.on('stateChange', (nobleState) => {
    /*
        noble states:   'unknown', 'resetting', 'unsupported'
                        'unauthorized', 'poweredOff', 'poweredOn'
    */
    state = nobleState;
    if(state !== 'poweredOn') {
        stopScanning();
    }
    myEmitter.emit('stateChange', state);
});

noble.on('discover', (peripheral) => {
    console.log('\nFound', peripheral.address);
    peripherals[peripheral.address] = peripheral;
});

noble.on('warning', (message) => {
    console.log('\nnoble warning: ' + message);
});

function scan() {
    if (state !== 'poweredOn') throw new Error('Not in powered on state');
    return new Promise((resolve, reject) => {
        console.log('\nScanning...');
        peripherals = [];
        noble.startScanning([], false, (err) => {
            if (err) return reject(new Error(err));
            else resolve();
        });
    });
}

function stopScanning() {
    if (state !== 'poweredOn') throw new Error('Not in powered on state');
    console.log('\nStopped scanning.');
    noble.stopScanning(() => {return Promise.resolve();});
}

function connect(address) {
    let addListeners = (peripheral) => {
        let connectHandler = () => {console.log('\nConnected to address', peripheral.address)};
        let disconnectHandler = () => {
            commandChar = null;
            connTypeChar = null;
            devInfoChar = null;
            indicateValues = [];
            readValues = [];
            peripheral.removeAllListeners();
            myEmitter.emit('disconnect', peripheral.address);
            console.log('\nDisconnected from address', peripheral.address);
        };
        let rssiUpdateHandler = (rssi) => {myEmitter.emit('rssiUpdate', peripheral.address, rssi);};
        peripheral.on('connect', connectHandler);
        peripheral.on('disconnect', disconnectHandler);
        peripheral.on('rssiUpdate', rssiUpdateHandler);
        return Promise.resolve(peripheral);
    };

    let connectToPeripheral = (peripheral) => {
        return new Promise((resolve, reject) => {
            peripheral.connect((err) => {
                if (err) return reject(new Error(err));
                resolve(peripheral);
            });
        });
    };

    let discoverAttributes = (peripheral) => {
        return new Promise((resolve, reject) => {
            let attributesHandler = (err, services, characteristics) => {
                if (err) return reject(new Error(err));
                characteristics.forEach((characteristic) => {
                    indicateValues[characteristic.uuid] = '';
                    readValues[characteristic.uuid] = '';
                });
                commandChar = characteristics[0];
                connTypeChar = characteristics[1];
                devInfoChar = characteristics[2];
                if (!commandChar || !connTypeChar || !devInfoChar) {
                    return reject(new Error('Failed to discover characteristics'));
                }
                resolve(characteristics);
            };
            let services = [uuids.RENTLY_SERVICE];
            let characteristics = [
                uuids.COMMAND_CHAR,
                uuids.CONN_TYPE_CHAR,
                uuids.DEV_INFO_CHAR
            ];
            peripheral.discoverSomeServicesAndCharacteristics(services, characteristics, attributesHandler);
        });
    };

    let subscribeToCharacteristics = (characteristics) => {
        let subscribeToIndicate = (characteristic) => {
            return new Promise((resolve, reject) => {
                if (!characteristic) return reject(new Error('Failed to subscribe'));
                characteristic.on('data', (data, isNotification) => {
                    let status = data.readUInt8(0);
                    let payload = data.slice(1);
                    if (status & STATUS.READ) {
                        readValues[characteristic.uuid] += payload.toString('utf-8');
                        if (status & STATUS.EOT) {
                            try {myEmitter.emit('data', JSON.parse(readValues[characteristic.uuid]), characteristic.uuid);}
                            catch(err) {myEmitter.emit('error', new Error(err));}
                            readValues[characteristic.uuid] = '';
                        }
                    } else {
                        indicateValues[characteristic.uuid] += payload.toString('utf-8');
                        if (status & STATUS.EOT) {
                            try {myEmitter.emit('data', JSON.parse(indicateValues[characteristic.uuid]), characteristic.uuid);}
                            catch(err) {myEmitter.emit('error', new Error(err));}
                            indicateValues[characteristic.uuid] = '';
                        }
                    }
                });
                characteristic.subscribe((err) => {
                    if (err) return reject(new Error(err));
                    resolve();
                });
            });
        };
        return Promise.all([
            subscribeToIndicate(connTypeChar),
            subscribeToIndicate(devInfoChar)
        ]);
    };

    return new Promise((resolve, reject) => {
        let peripheral = peripherals[address];
        if (!peripheral) return reject(new Error('Failed to connect'));
        addListeners(peripheral)
            .then(connectToPeripheral)
            .then(discoverAttributes)
            .then(subscribeToCharacteristics)
            .then(() => resolve())
            .catch((err) => reject(new Error(err)));
    });
}

function disconnect(address) {
    return new Promise((resolve, reject) => {
        let peripheral = peripherals[address];
        if (!peripheral) return reject(new Error('Failed to disconnect'));
        peripheral.disconnect((err) => {
            if (err) return reject(new Error(err));
            else resolve();
        });
    });
}

function send(obj) {
    return new Promise((resolve, reject) => {
        let writeChunk = () => {
            commandChar.write(writeQ.shift(), false, (err) => {
                if (err) return reject(new Error('Failed to send'));
                if (writeQ.length === 0) resolve();
                else writeChunk();
            });
        };
        if (!commandChar) return reject(new Error('Failed to send'));
        let data = new Buffer(JSON.stringify(obj));
        let length = data.byteLength;
        let writeQ = [];
        if (Math.ceil(length/chunkSize) > maxQLength) return reject(new Error('Write queue full'));
        for (var start = 0, end = chunkSize; start < length; start += chunkSize, end += chunkSize) {
            let chunk = data.slice(start, Math.min(length, end));
            writeQ.push(chunk);
            if (start + chunkSize >= length) writeQ.push(new Buffer(0));
        }
        writeChunk();
    });
}

function on(event, callback) {
    /**
     * Events:
     * 'stateChange', 'scanStart', 'scanStop',
     * 'disconnect', 'data', 'rssiUpdate'
     */
    myEmitter.on(event, callback);
    return module.exports;
}

function once(event, callback) {
    myEmitter.once(event, callback);
    return module.exports;
}

function read(uuid) {
    return new Promise((resolve, reject) => {
        let readChunk = (characteristic) => {
            characteristic.read((err, data) => {
                if (err) reject(err);
                if (data.readUInt8(0) === (STATUS.READ | STATUS.EOT)) return resolve();
                else readChunk(characteristic);
            });
        };
        switch (uuid) {
            case uuids.CONN_TYPE_CHAR:
                readChunk(connTypeChar, resolve);
                break;
            case uuids.DEV_INFO_CHAR:
                readChunk(devInfoChar, resolve);
                break;
            default:
                return reject(new Error('Failed to read'));
        }
    });
}

module.exports.scan = scan;
module.exports.stopScanning = stopScanning;
module.exports.connect = connect;
module.exports.disconnect = disconnect;
module.exports.send = send;
module.exports.on = on;
module.exports.once = once;
module.exports.read = read;