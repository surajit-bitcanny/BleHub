'use strict'

const bleno = require('bleno');
const uuids = require('./uuids').uuids;

const IndicateCharacteristic = require('./indicateCharacteristic');

const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

var indicateQ = [];
var outstandingIndications = 0;
var maxQLength = 100000;

var command = '';

const commandChar = new bleno.Characteristic({
    uuid: uuids.commandCharUuid,
    properties: ['write'],
    onWriteRequest: function(data, offset, withoutResponse, callback) {
        if(data.byteLength > 0) {
            command += data.toString('utf-8');
        } else {
            myEmitter.emit('received', JSON.parse(command));
            command = '';
        }
        callback(this.RESULT_SUCCESS);
    }
});
const connTypeChar = new IndicateCharacteristic(uuids.connTypeCharUuid);
const devInfoChar = new IndicateCharacteristic(uuids.devInfoCharUuid);
const services = [
    new bleno.PrimaryService({
        uuid : uuids.serviceUuid,
        characteristics : [commandChar, connTypeChar, devInfoChar]
    })
];

/*
    Set emitters so that we can listen for 'setValue' and 'onIndicate'
    events in the IndicateCharacteristics
*/

devInfoChar.setEmitter(myEmitter);
connTypeChar.setEmitter(myEmitter);

on('valueChange', (characteristic, obj) => {
    // Chunk data
    let data = Buffer(JSON.stringify(obj));
    let length = data.byteLength;
    var chunkSize = 20;

    for (var start = 0, end = chunkSize; start < length; start += chunkSize, end += chunkSize) {
        let chunk = data.slice(start, Math.min(length, end));
        if(indicateQ.length < maxQLength) {
            indicateQ.push({
                characteristic: characteristic,
                data: chunk
            });
        } else {
            myEmitter.emit('error', 'Indicate queue is full');
        }
        // Queue an empty buffer once all the data has been queued - used to signal end of transmission
        if(start + chunkSize >= length) {
            if(indicateQ.length < maxQLength) {
                indicateQ.push({
                    characteristic: characteristic,
                    data: new Buffer(0)
                });
            } else {
                myEmitter.emit('error', 'Indicate queue is full');
            }
        }
    }

    if(outstandingIndications === 0 && indicateQ.length > 0) {
        let obj = indicateQ.shift();
        let characteristic = obj.characteristic;
        let data = obj.data;
        characteristic.indicate(data);
        outstandingIndications++;
    }
});

on('onIndicate', () => {
    outstandingIndications--;
    if(indicateQ.length > 0) {
        let obj = indicateQ.shift();
        let characteristic = obj.characteristic;
        let data = obj.data;
        characteristic.indicate(data);
        outstandingIndications++;
    }
});

bleno.on('stateChange', function(state) {
    if (state === 'poweredOn') {
        startAdvertising();
        myEmitter.emit('stateChange', state);
    } else {
        stopAdvertising();
    }
});

bleno.on('advertisingStart', function(err) {
    if (!err) {
        console.log('\nAdvertising...');
        bleno.setServices(services);
        myEmitter.emit('advertisingStart', services);
    } else {
        myEmitter.emit('error', 'Advertising start error: ' + err);
    }
});

bleno.on('accept', function(clientAddress) {
    console.log('\nAccepted connection from address', clientAddress);
    myEmitter.emit('accept', clientAddress);
});

bleno.on('disconnect', function(clientAddress) {
    console.log('\nDisconnected from address', clientAddress, '\n');
    myEmitter.emit('disconnect', clientAddress);
});

function startAdvertising() {
    bleno.startAdvertising('peripheral', [uuids.serviceUuid], (err) => {
        if (err) {
            myEmitter.emit('error', 'Start advertising error: ' + err);
        }
    });
}

function stopAdvertising() {
    bleno.stopAdvertising();
    myEmitter.emit('advertisingStop');
}

function on(event, callback) {
    //
    //  Events: 'stateChange', 'advertisingStart', 'advertisingStart', 'accept', 'disconnect',
    //          'send', 'received', 'error', 'valueChange'
    //
    myEmitter.on(event, callback);
    return module.exports;
}

function once(event, callback) {
    myEmitter.once(event, callback);
    return module.exports;
}

module.exports.startAdvertising = startAdvertising;
module.exports.stopAdvertising = stopAdvertising;
module.exports.commandChar = commandChar;
module.exports.connTypeChar = connTypeChar;
module.exports.devInfoChar = devInfoChar;
module.exports.on = on;
module.exports.once = once;