/// <reference path="typings/app.d.ts" />

/**
 * Created by ubuntu on 14-10-24.
 */

_=require('lodash');
Promise=require('bluebird');

//ErrorClass = Error;

moment=require('moment');
async=require('asyncawait/async');
await=require('asyncawait/await');
process.env["NODE_CONFIG_DIR"]=require("path").resolve(__dirname,"../config");
config=require('config');

//refer to: http://stackoverflow.com/questions/11605577/node-js-concurrent-https-requests-econnrefused
require('http').globalAgent.maxSockets = 64;
require('https').globalAgent.maxSockets = 64;


