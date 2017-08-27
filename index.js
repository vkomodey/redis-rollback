'use strict';

let bluebird = require('bluebird');
let redis = require('redis');
let fs = require('fs');
let _ = require('lodash');

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
        args: _.isArray(args) ? args : [args],
    };
}

function execMulti(client, instructions) {
    let multi = client.multi();
    for (let instr of instructions) {
        multi[instr.cmd].apply(multi, instr.args);
    }

    return new Promise((resolve, reject) => {
        multi.exec((err, replies) => err ? reject(err) : resolve(replies));
    });
}

function tryRollback(client, mainReplies, rollbackCommands) {
    let errIndexes = [];
    mainReplies.forEach((reply, index) => {
        if ( reply instanceof redis.ReplyError ) {
            errIndexes.push(index);
        };
    });

    if (errIndexes.length > 0) {
        // Need to rollback only operations, which were performed successfully
        let commandsToRollback = rollbackCommands.filter((reply, index) => !errIndexes.includes(index));

        return execMulti(client, commandsToRollback)
            .then(res => Promise.reject('Operation has been rolled back'));
    }

    return mainReplies;
}

function execAtomic(client, transactionCommands) {
    return execMulti(client, transactionCommands.main)
        .then(replies => tryRollback(client, replies, transactionCommands.rollback));
}

client.once('connect', function() {
    return Promise.all([client.set('a', 1), client.set('b', '123e'), client.set('c', 1),])
        .then(() => {
            let commands = {
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
            
            return execAtomic(client, commands)
        })
        .then(replies => {
            console.log(replies);
            return client.quit();
        })
        .catch((err) => {
            console.log({err});

            return client.quit();
        })
});
