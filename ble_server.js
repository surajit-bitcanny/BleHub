#!/usr/bin/env node
"use strict";

var bleno = require('bleno');
var util = require('util');
var BlenoCharacteristic = bleno.Characteristic;
var BlenoPrimaryService = bleno.PrimaryService;
var BlenoDescriptor = bleno.Descriptor;
var maxPacketSize = 20;

var descriptor = new BlenoDescriptor({
    uuid: 'ff56',
    value: '876511' // static value, must be of type Buffer or string if set
});

var EchoCharacteristic = function() {
  EchoCharacteristic.super_.call(this, {
    uuid: 'ec0e',
    properties: ['read', 'write', 'notify'],
    value: null
  });

  //this._value = new Buffer("4e4585c0-cffb-48c6-a18f-c9d17f6f1a50|2017-07-20T10:48:47Z","ascii");
  this._updateValueCallback = null;
  this.resetBuffer();
};

util.inherits(EchoCharacteristic, BlenoCharacteristic);

EchoCharacteristic.prototype.resetBuffer = function(){
	this.readFlag = false;
  	this.writeFlag = false;
  	this.writeIndex = 0;
  	this.readIndex = 0;
  	this._value = new Buffer(1024*8).fill(0);
};

EchoCharacteristic.prototype.onReadRequest = function(offset, callback) {
  //console.log('EchoCharacteristic - onReadRequest: value = ' + this._value.toString('ascii'));

    var remainingBytes = this.writeIndex - this.readIndex;
    var bytesToSend = Math.min(remainingBytes,maxPacketSize-1);

    var status = (this.readIndex + maxPacketSize < this.writeIndex) ? '1' : '0';
    var data = Buffer.concat([new Buffer(status), this._value.slice(this.readIndex,this.readIndex+bytesToSend)]);

    this.readIndex+=bytesToSend;

    if(status === '0'){
        this.readFlag = false;
        console.log('EchoCharacteristic - onReadRequest: read stopped ');
        var readStopTime = new Date();
        console.log("Data length "+this.readIndex);
        this.readIndex = 0;
        console.log("Read time : "+ (readStopTime-this.readStartTime)/1000 + "sec");
    } else{
        this.readFlag = true;
        this.readStartTime = new Date();
        console.log('EchoCharacteristic - onReadRequest: read started ');
    }

    //console.log('EchoCharacteristic - onReadRequest: value = ' + data.toString('ascii'));

    callback(this.RESULT_SUCCESS, data);
};

EchoCharacteristic.prototype.onWriteRequest = function(data, offset, withoutResponse, callback) {
  var str = data.toString("ascii",0,4);
  if(str.length == 4 && str === 'STRT'){
  	console.log('EchoCharacteristic - onWriteRequest: write started...');
  	this.resetBuffer();
  	this.writeFlag = true;
  	callback(this.RESULT_SUCCESS);
  	this.writeStartTime = new Date();
  	return;
  } else if(str.length == 4 && str === 'STOP'){
  	console.log('EchoCharacteristic - onWriteRequest: write stopped...');
  	this.writeFlag = false;
  	var writeStopTime = new Date();
  	console.log("Data length "+this.writeIndex);
  	console.log("Write time : "+ (writeStopTime-this.writeStartTime)/1000 + "sec");
  }
  
  if(this.writeFlag){
	  //console.log('EchoCharacteristic - onWriteRequest: value = ' + str);
      data.copy(this._value,this.writeIndex);
	  //this._value.write(str,this.writeIndex);
	  this.writeIndex += data.length;
	  if (this._updateValueCallback) {
	    console.log('EchoCharacteristic - onWriteRequest: notifying');
	    this._updateValueCallback(data);
	  }
  } else{
  	console.log('EchoCharacteristic - onWriteRequest: value = ' + this._value.toString('ascii'));
  }

  callback(this.RESULT_SUCCESS);
};

EchoCharacteristic.prototype.onSubscribe = function(maxValueSize, updateValueCallback) {
  console.log('EchoCharacteristic - onSubscribe');

  this._updateValueCallback = updateValueCallback;
};

EchoCharacteristic.prototype.onUnsubscribe = function() {
  console.log('EchoCharacteristic - onUnsubscribe');

  this._updateValueCallback = null;
};


console.log('bleno - echo');

bleno.on('stateChange', function(state) {
  console.log('on -> stateChange: ' + state);

  if (state === 'poweredOn') {
    bleno.startAdvertising('echo', ['ec00']);
  } else {
    bleno.stopAdvertising();
  }
});

bleno.on('advertisingStart', function(error) {
  console.log('on -> advertisingStart: ' + (error ? 'error ' + error : 'success'));

  if (!error) {
    bleno.setServices([
      new BlenoPrimaryService({
        uuid: 'ec00',
        characteristics: [
          new EchoCharacteristic()
        ]
      })
    ]);
  }
});
