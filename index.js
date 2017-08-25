'use strict';

let bluebird = require('bluebird');
let redis = require('redis');
let fs = require('fs');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

let client = redis.createClient();

let handler = {
    get(target, propKey, receiver) {
        return function(...args) {
            if (propKey.indexOf('Async') !== -1) {
                return target[propKey].apply(target, args);
            }
            return target[`${propKey}Async`].apply(target, args);
        }
    }
};

function redisTxnInstruction(cmd, args) {
    return {
        cmd,
        args,
    };
}

function execMulti(client, instructions, cb) {
    let multi = client.multi();
    for (let instr of instructions) {
        multi[instr.cmd].apply(multi, ...instr.args);
    }

    multi.exec(cb);
}

function isTransactionFailed(replies) {
    return replies.filter(r => r instanceof redis.ReplyError).length > 0;
}

function tryRollback(client, replies, rollbackInstructions) {
    let errIndexes = [];
    replies.forEach((reply, index) {
        if ( reply instanceof Redis.ReplyError ) {
            errIndexes.push(index);
        };
    });

    if (errIndexes.length > 0) {
        let instructions = rollbackInstructions.filter((reply, index) => errIndexes.includes(index));

        return execMulti(client, instructions);
    }

    return Promise.resolve();
}

function execAtomic(client, txnCmds) {
    let  { mainInstructions, rollbackInstructions } = txnCmds;
    let multi = client.multi();
    return new Promise((resolve, reject) {
        execMulti(client, mainInstructions, function(err, replies) {
            
        });
    });
}

client.once('connect', function() {
    let pClient = new Proxy(client, handler);
    let p1 = pClient.set('a', 2);
    let p2 = pClient.set('b', '2b');
    let p3 = pClient.set('c', 2);

    let txnCmds = {
        main: [
            redisTxnInstruction('incr', 'a'),
            redisTxnInstruction('incr', 'b'),
            redisTxnInstruction('incr', 'c'),
        ],
        rollback: [
            redisTxnInstruction('decr', 'a'),
            redisTxnInstruction('decr', 'b'),
            redisTxnInstruction('decr', 'c'),
        ],
    }

    let multi = client.multi();
    multi.incr('a');
    multi.incr('b');
    multi.incr('c');

    multi.exec(function(err, replies) {
        client.quit();
    });
});
