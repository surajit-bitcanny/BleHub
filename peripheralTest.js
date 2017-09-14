/**
 * Created by London on 8/3/17.
 */

'use strict'

const p = require('./peripheralNew');
const uuids = require('./uuids');

p.on('stateChange', (state) => {
    if(state === 'poweredOn') {
        p.startAdvertising()
            .then(()=>initValues())
            .catch((error)=>console.log(error));
    } else {
        p.stopAdvertising();
    }
});

function initValues(){
    setRandomConnectionType();
    setRandomDeviceInfo();
}

function setRandomConnectionType(){
    var myArray = ['e','w','c','n'];
    var item = myArray[(Math.random()*myArray.length)|0];
    p.setCharacteristicValue(uuids.CONN_TYPE_CHAR,{
        "ct":item
    });
}

function setRandomDeviceInfo() {
    var myArray = [10,11,12,13,14,15,16];
    var item = myArray[(Math.random()*myArray.length)|0];
    var device={};
    var model = 134+item;
    model = model.toString() + '-1-1';
    device[item] = ['lock',model];
    p.setCharacteristicValue(uuids.DEV_INFO_CHAR,device);
}

function bytes(size) {
    var str = '';
    for(let i = 0; i < size; i++) {
        str += 'a';
    }
    return str;
}

p.on('received', (data) => {
    console.log('\nReceived command:', JSON.stringify(data));


    setRandomConnectionType();
    setRandomDeviceInfo();

    p.indicate(uuids.DEV_INFO_CHAR);
    p.indicate(uuids.CONN_TYPE_CHAR);


});