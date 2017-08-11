/**
 * Created by London on 8/7/17.
 */
'use strict'

var util = require('util');
var events = require('events');
var bleno = require('bleno');

var IndicateCharacteristic = function(uuid) {
    IndicateCharacteristic.super_.call(this, {
        uuid: uuid,
        properties: ['indicate'],
        value: null
    });

    this._value = null;
    this._updateValueCallback = null;
    this._emitter = null;
};

util.inherits(IndicateCharacteristic, bleno.Characteristic);

IndicateCharacteristic.prototype.onSubscribe = function(maxValueSize, updateValueCallback) {
    this._updateValueCallback = updateValueCallback;
};

IndicateCharacteristic.prototype.onUnsubscribe = function() {
    this._updateValueCallback = null;
};

IndicateCharacteristic.prototype.getValue = function() {
    return this._value;
};

IndicateCharacteristic.prototype.setValue = function(obj) {
    this._value = obj;
    if(this._emitter) {
        this._emitter.emit('valueChange', this, obj);
    }
};

IndicateCharacteristic.prototype.onIndicate = function() {
    if(this._emitter) {
        this._emitter.emit('onIndicate');
    }
};

IndicateCharacteristic.prototype.indicate = function(data) {
    /*
        Workaround: call setImmediate or else not all indications will get sent
    */
    setImmediate(() => {
        if (this._updateValueCallback) {
            /*
                Max 20 bytes, otherwise undefined behavior
            */
            this._updateValueCallback(data);
        }
    });
};

IndicateCharacteristic.prototype.setEmitter = function(emitter) {
    // This emitter will be set to the emitter in peripheral.js so that peripheral.js
    // can listen for 'setValue' events and 'onIndicate' events. This is all so that
    // we can implement an indicate queue in peripheral.js
    this._emitter = emitter;
};

module.exports = IndicateCharacteristic;