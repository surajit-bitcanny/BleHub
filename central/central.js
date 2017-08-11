/**
 * Created by London on 8/3/17.
 */

'use strict'

const noble = require('noble');
const uuids = require('./uuids').uuids;

const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const scanTimeout = 3000;

var writeQ = [];
var outstandingWrites = 0;
var maxQLength = 100000;

var peripherals = [];

var commandChar = null;
var connTypeChar = null;
var devInfoChar = null;

/*
The following strings are used to capture connection type and device
info objects from the peripheral.

Since the maximum indication size is 20 bytes, and a
connectionType/deviceInfo object could potentially be larger than
this, we break each object up into 20 byte strings and indicate one
chunk at a time.

Each time we receive an indication, we concatenate the data to the
end of the string.

Once the last chunk has been sent, the peripheral will indicate an
empty Buffer. This way we know the full object has been received.
*/

var connectionType = '';
var deviceInfo = '';

noble.on('stateChange', (state) => {

    //  noble states:
    //  - "unknown"
    //  - "resetting"
    //  - "unsupported"
    //  - "unauthorized"
    //  - "poweredOff"
    //  - "poweredOn"

    if(state !== 'startScanning') {
        stopScanning();
    }
    myEmitter.emit('stateChange', state);
});
noble.on('discover', (peripheral) => {
    console.log('\nFound', peripheral.address);
    peripherals.push(peripheral);
});
noble.on('warning', (message) => {
    console.log('\nnoble warning: ' + message);
});
noble.on('scanStart', () => {
    myEmitter.emit('scanStart');
});
noble.on('scanStop', () => {
    myEmitter.emit('scanStop');
});

function startScanning() {
    console.log('\nScanning...');
    peripherals = [];
    noble.startScanning();
    setTimeout(() => {
        stopScanning();
        myEmitter.emit('scanComplete');
    }, scanTimeout);
}

function stopScanning() {
    console.log('\nStopped scanning.');
    noble.stopScanning();
}

function connect(address) {
    let peripheral = getPeripheral(address);
    if(peripheral) {
        peripheral.on('connect', () => {
            /*
                But do not emit 'connect' until we have discovered
                and subscribed to our characteristics.
             */
            console.log('\nConnected to address', peripheral.address);
        });
        peripheral.on('disconnect', () => {
            console.log('\nDisconnected from address', peripheral.address);
        });
        peripheral.on('rssiUpdate', (rssi) => {
            myEmitter.emit('rssiUpdate', peripheral.address, rssi);
        });
        peripheral.connect(function(err) {
            if (!err) {
                peripheral.discoverServices([uuids.serviceUuid], (err, services) => {
                    if(!err) {
                        services[0].discoverCharacteristics([], (err, characteristics) => {
                            if(!err)
                            {
                                /*
                                    Find characteristics
                                */
                                characteristics.forEach((characteristic) => {
                                    if(characteristic.uuid == uuids.commandCharUuid) {
                                        commandChar = characteristic;
                                    }
                                    else if(characteristic.uuid == uuids.connTypeCharUuid) {
                                        connTypeChar = characteristic;
                                    }
                                    else if(characteristic.uuid == uuids.devInfoCharUuid) {
                                        devInfoChar = characteristic;
                                    }
                                });
                                if (commandChar && connTypeChar && devInfoChar) {
                                    /*
                                        Subscribe to characteristics
                                    */
                                    commandChar.on('write', () => {
                                        outstandingWrites--;
                                        if(writeQ.length > 0) {
                                            commandChar.write(writeQ.shift());
                                            outstandingWrites++;
                                        }
                                    });
                                    connTypeChar.subscribe((err) => {
                                        if(!err) {
                                            connTypeChar.on('data', (data) => {
                                                if(data.byteLength > 0) {
                                                    connectionType += data.toString('utf-8');
                                                } else {
                                                    myEmitter.emit('data', connTypeChar, JSON.parse(connectionType));
                                                    connectionType = '';
                                                }
                                            });
                                            devInfoChar.subscribe((err) => {
                                                if(!err) {
                                                    devInfoChar.on('data', (data) => {
                                                        if(data.byteLength > 0) {
                                                            deviceInfo += data.toString('utf-8');
                                                        } else {
                                                            myEmitter.emit('data', devInfoChar, JSON.parse(deviceInfo));
                                                            deviceInfo = '';
                                                        }
                                                    });
                                                    /*
                                                          Emit 'connect'
                                                    */
                                                    myEmitter.emit('connect', peripheral.address);
                                                } else {
                                                    myEmitter.emit('error', 'Connect error: Could not subscribe to char: ' + devInfoChar.uuid);
                                                }
                                            });
                                        } else {
                                            myEmitter.emit('error', 'Connect error: Could not subscribe to char: ' + connTypeChar.uuid);
                                        }
                                    });
                                } else {
                                    myEmitter.emit('error', 'Connect error: Missing characteristics: ' +
                                    (!commandChar) ? commandChar.uuid + ' ' : '' +
                                    (!connTypeChar) ? connTypeChar.uuid + ' ' : '' +
                                    (!devInfoChar) ? devInfoChar.uuid + ' ' : '');
                                }
                            } else {
                                myEmitter.emit('error', 'Connect error: Could not discover characteristics, service ' + uuids.serviceUuid);
                            }

                        });
                    } else {
                        myEmitter.emit('error', 'Connect error: Could not find serviceUuid ' + uuids.serviceUuid);
                    }
                });
            }
        });
    } else {
        myEmitter.emit('error', 'Connect error: Could not find peripheral, address ' + address);
    }
}

function disconnect(address) {
    let peripheral = getPeripheral(address);
    if(peripheral) {
        peripheral.disconnect((err) => {
            if(!err) {
                commandChar = null;
                connTypeChar = null;
                devInfoChar = null;
                connectionType = '';
                deviceInfo = '';
                console.log('\nDisconnected from address ' + peripheral.address);
                myEmitter.emit('disconnect', peripheral.address);
            } else {
                myEmitter.emit('error', err);
            }
        });
    } else {
        myEmitter.emit('error', 'Disconnect error: address not found ' + address);
    }
}

function send(obj) {
    return new Promise((resolve, reject) => {
        if(commandChar) {
            let data = new Buffer(JSON.stringify(obj));
            let length = data.byteLength;
            var chunkSize = 512;

            if(writeQ.length + Math.ceil(length/chunkSize) < maxQLength) {
                for (var start = 0, end = chunkSize; start < length; start += chunkSize, end += chunkSize) {
                    let chunk = data.slice(start, Math.min(length, end));
                    writeQ.push(chunk);
                    if(start + chunkSize >= length) {
                        writeQ.push(new Buffer(0));
                    }
                }
                if(outstandingWrites === 0 && writeQ.length > 0) {
                    commandChar.write(writeQ.shift());
                    outstandingWrites++;
                }
                resolve();

            } else {
                myEmitter.emit('error', 'Send error: Write queue is full');
                reject('Send error: Write queue is full');
            }
        } else {
            myEmitter.emit('error', 'Send error: Character null ' + commandChar.uuid);
            reject('Send error: Character null ' + commandChar.uuid);
        }
    })

}

function on(event, callback) {
    /*
        Events: 'stateChange', 'scanStart', 'scanComplete', 'scanStop',
                'connect', 'disconnect', 'data', 'error', 'rssiUpdate'
    */
    myEmitter.on(event, callback);
    return module.exports;
}

function once(event, callback) {
    myEmitter.once(event, callback);
    return module.exports;
}

function getPeripheral(address) {
    for(let i = 0; i < peripherals.length; i++) {
        let peripheral = peripherals[i];
        if (peripheral.address.toUpperCase() === address.toUpperCase()) {
            return peripheral;
        }
    }
    myEmitter.emit('error', 'Get peripheral error: address null ' + address);
    return null;
}

module.exports.startScanning = startScanning;
module.exports.stopScanning = stopScanning;
module.exports.connect = connect;
module.exports.disconnect = disconnect;
module.exports.send = send;
module.exports.commandChar = commandChar;
module.exports.connTypeChar = connTypeChar;
module.exports.devInfoChar = devInfoChar;
module.exports.on = on;
module.exports.once = once;