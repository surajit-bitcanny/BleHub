/**
 * Created by London on 8/3/17.
 */

'use strict'

const c = require('./central');

c.on('stateChange', (state) => {
    if (state === 'poweredOn') {
        c.startScanning();
    };
});

c.on('scanComplete', () => {
    //c.connect('06:0e:09:c2:c6:b4');
    c.connect('06:ce:09:41:b3:e7');
});

function bytes(size) {
    var str = '';
    for(let i = 0; i < size; i++) {
        str += 'a';
    }
    return str;
}

c.on('connect', () => {
    c.send({ m : 'sc',
        n : 12345678910,
        s : 4,
        g : bytes(1000),
        c : 54321
    })
});


c.on('data', (characteristic, data) => {
    console.log('\nWe got data from ' + characteristic.uuid + ': ' + JSON.stringify(data));
});

c.on('error',(data)=>{
   console.log("Error : "+data);
});