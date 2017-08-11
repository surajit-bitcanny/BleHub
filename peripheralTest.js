/**
 * Created by London on 8/3/17.
 */

'use strict'

const p = require('./peripheral');

p.on('stateChange', (state) => {
    if(state === 'poweredOn') {
        p.startAdvertising();
    } else {
        p.stopAdvertising();
    }
});

function bytes(size) {
    var str = '';
    for(let i = 0; i < size; i++) {
        str += 'a';
    }
    return str;
}

p.on('received', (data) => {
    console.log('\nReceived command:', JSON.stringify(data));
    p.devInfoChar.setValue({
        i : '1123456789012345678901234567890123456789012345678'
    });

    p.devInfoChar.setValue({
        i : '1234567890-=qwertyuiop[]asdfghjkl;zxcvbnm,./'
    });

    p.connTypeChar.setValue({
        i : 'aaaaasssssdddddfffffggggghhhhhhjjjjjkkkkkklllllzzzzzxxxxxcccccvvvvvv'
    });

    p.connTypeChar.setValue({
        i : bytes(1000),
        done: 'yes'
    });

    p.devInfoChar.setValue({
        i : '11111222222333334444455555566666677777788888999990000099999888888777776666655555544444333332222211111'
    });

    p.connTypeChar.setValue({
        i : 6
    });
});