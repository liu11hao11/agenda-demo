/**
 * Created by Alex Liu on 2016/11/16.
 */
var config = require("config");
var _ = require('lodash');
var path = require('path');
var mongoose = require("mongoose");
mongoose.Promise = require('bluebird');

var mongooseDbMap = {};
require("./globals");
exports.fetchMongooseDb = function (mongoDbUri) {
    var url = mongoDbUri || config.mongoDb.mongourl;
    if (!mongooseDbMap[url]) {

        var conn = mongoose.connect(url);
        mongooseDbMap[url] = conn;
    }
    return mongooseDbMap[url];
};
exports.Mixed = mongoose.Schema.Types.Mixed;

exports.getErrMessage = function (ex) {
    if (exports.isHttpError(ex)) {
        if (_.isObject(ex.message)) {
            if (ex.message.errDesc) {
                var errCodePart = "";
                if (ex.message.errCode)
                    errCodePart = " 错误代码:" + ex.message.errCode;
                return ex.message.errDesc + errCodePart;
            }
            if (ex.message.error) {
                var errCodePart = "";
                if (ex.message.errCode)
                    errCodePart = " 错误代码:" + ex.message.errCode;
                return ex.message.error + errCodePart;
            }
            return JSON.stringify(ex.message);
        }
        if (_.isArray(ex.message)) {
            if (!_.isEmpty(ex.message))
                return ex.message[0].msg;
            return JSON.stringify(ex.message);
        }
        return ex.message;
    }
    else {
        return ex.message;
    }
};
exports.uncaughtExceptionHandler = function (beforeExitHandler, delayMs) {
    if (beforeExitHandler === void 0) {
        beforeExitHandler = undefined;
    }
    if (delayMs === void 0) {
        delayMs = 1000;
    }
    process.on('uncaughtException', function (err) {
        var theLog = log || console;
        if (theLog)
            theLog.error('uncaughtException', err.message, err.stack);
        if (err.message.indexOf("Lock not granted. Try restarting the transaction.") > -1) {
            var db = exports.fetchMongooseDb();
            db.collection('$cmd.sys.inprog').findOne(function (err, data) {
                if (err) {
                    throw err;
                }
                theLog.info("currentOp", data.inprog);
            });
        }
        return async(function () {
            await(Promise.delay(delayMs)); //
            if (beforeExitHandler)
                await(beforeExitHandler());
            process.exit();
        })();
    });
};
exports.tryNTimesPromise = function (times, func, retryInterval) {
    if (retryInterval === void 0) {
        retryInterval = 5000;
    }
    return async(function () {
        var theErr;
        for (var i = 0; i < times; i++) {
            try {
                return await(func());
            }
            catch (err) {
                theErr = err;
                log.error("tryNTimesPromise", "No." + i, err);
                if (theErr && theErr.noRetry) {
                    delete theErr.noRetry;
                    throw theErr;
                }
                await(Promise.delay(retryInterval));
            }
        }
        if (theErr)
            throw theErr;
    })();
};

var loggerPrettyStreamUsed = false;
var stdout = process.stdout;
var stderr = process.stderr;
var stdin = process.stdin;
exports.getLoggerOption = function (name) {
    var logConfig = config.log[name] || config.log["default"];
    if (config.log["usePrettyStream"] || process.env["USE-PRETTY-STREAM"]) {
        if (!loggerPrettyStreamUsed) {
            var PrettyStream = require('bunyan-prettystream');
            stdout = new PrettyStream();
            stdout.pipe(process.stdout);
            stderr = new PrettyStream();
            stderr.pipe(process.stderr);
            stdin = new PrettyStream();
            stdin.pipe(process.stdin);
            loggerPrettyStreamUsed = true;
        }
    }
    var cloneLogConfig = _.cloneDeep(logConfig);
    if (!_.isEmpty(cloneLogConfig.streams)) {
        cloneLogConfig.streams.forEach(function (it) {
            if (it.stream === "stdout") {
                it.stream = stdout;
            }
            if (it.stream === "stderr") {
                it.stream = stderr;
            }
            if (it.stream === "stdin") {
                it.stream = stdin;
            }
        });
    }
    if (!_.isUndefined(config.log["src"])) {
        cloneLogConfig["src"] = config.log["src"];
    }
    var rst = _.extend({name: name || "default"}, cloneLogConfig);
    return rst;
};
exports.getReqLoggerOpt = function () {
    return _.extend(exports.getLoggerOption("req"), {
        levelFn: function (status, err) {
            if (err || status >= 500) {
                return "error";
            }
            else if (status >= 400) {
                return "warn";
            }
            return "trace";
        }
    });
};
exports.getLogger = function (name, options) {
    var bunyan = require("bunyan");
    var theOptions = options || {};
    var logger = bunyan.createLogger(_.defaults(theOptions, exports.getLoggerOption(name)));
    logger.on('error', function (err, stream) {
        if (log) {
            log.warn("log[" + name + "] create error", err, stream);
        }
        else {
            console.log("log[" + name + "] create error", err, stream);
        }
    });
    return logger;
};
var log = exports.getLogger("lottery_lib");

function exists(val) {
    return !(_.isUndefined(val) || _.isNull(val));
}
exports.exists = exists;

function getFileName(o) {
    return path.basename(o, path.extname(o))
}
exports.getFileName = getFileName;
function getDirname(o) {
    return path.dirname(o)
}
exports.getDirname = getDirname;
function getFileNameUrlWithoutType(o) {
    var posPoint = o.lastIndexOf(".");
    return o.substring(0, posPoint);
}
exports.getFileNameUrlWithoutType = getFileNameUrlWithoutType;

function getFileType(o) {
    var posPoint = o.lastIndexOf(".");
    return o.substring(posPoint + 1);
}
exports.getFileType = getFileType;

function unique(arr) {
    var result = [], hash = {};
    for (var i = 0, elem; (elem = arr[i]) != null; i++) {
        if (!hash[elem]) {
            result.push(elem);
            hash[elem] = true;
        }
    }
    return result;
}
exports.unique = unique;

var util = require("util");
exports.format = util.format;

exports.beautyJSON = function (obj) {
    var err;
    if (obj instanceof Error)
        err = {message: obj.message, stack: obj.stack};
    else
        err = obj;
    return JSON.stringify(err, null, 4);
};
function defineAgendaJob(agenda, jobName, asyncFunc) {
    agenda.define(jobName, config.agenda.jobDefaultOptions, async(function (job, done) {
        try {
            await(asyncFunc(job));
            done();
        }
        catch (ex) {
            var errStr = exports.beautyJSON(ex);
            done(exports.beautyJSON(ex));
        }
    }));
}
exports.defineAgendaJob = defineAgendaJob;
var _agendaJobRegistry = {};
var getJobDefineEnabled = function (jobDefine) {
    if (jobDefine.enabled === undefined) {
        if (!config.agenda.defaultEnabled)
            return false;
    }
    else if (!jobDefine.enabled)
        return false;
    return true;
};
function recreateJobFromDefine(agenda, jobDefine) {
    _agendaJobRegistry[jobDefine.name] = jobDefine;
    console.log(jobDefine)
    agenda.jobs({name: jobDefine.name}, function (err, jobs) {
        return async(function () {
            var createAndSaveJob = function () {
                log.info("创建AgendaJob", jobDefine.name);
                var job = agenda.create(jobDefine.name, jobDefine.data);
                if (!_.isEmpty(jobDefine.repeatEvery))
                    job.repeatEvery(jobDefine.repeatEvery);
                if (!_.isEmpty(jobDefine.repeatAt))
                    job.repeatAt(jobDefine.repeatAt);
                if (!_.isEmpty(jobDefine.schedule))
                    job.schedule(jobDefine.schedule);
                if (!_.isEmpty(jobDefine.priority))
                    job.priority(jobDefine.priority);
                job.save();
            };
            var jobEnabled = getJobDefineEnabled(jobDefine);
            if (_.isEmpty(jobs)) {
                if (jobEnabled)
                    createAndSaveJob();
            }
            else {
                if (!jobEnabled || jobDefine.alwaysRecreateJob) {
                    try {
                        await(agenda.cancel({name: jobDefine.name}));
                        if (!jobDefine.alwaysRecreateJob)
                            log.info("agenda cancelJob", jobDefine.name);
                    }
                    catch (ex) {
                        log.error("agenda cancelJob", jobDefine.name, ex);
                    }
                }
                if (jobEnabled && jobDefine.alwaysRecreateJob) {
                    //log.info("agenda createAndSaveJob",jobDefine.name)
                    createAndSaveJob();
                }
                else
                    log.warn("RecreateJobFromDefine发现该Job 已经存在且在使用中，请使用adminUI去修改job的执行计划", jobDefine.name);
            }
            agenda._collection.update({name: jobDefine.name}, {$set: {enabled: jobEnabled}}, function (err, rst) {
                if (err)
                    log.error("agenda._collection.update, set enabled failed, job.name", jobDefine.name);
            });
        })();
    });
}
exports.recreateJobFromDefine = recreateJobFromDefine;
exports.recreateAgendaJobsFromConfig = function (agenda) {
    _.each(config.agenda.jobs, function (jobDefine, name) {
        var theDefine = _.cloneDeep(jobDefine);
        theDefine.name = name;
        recreateJobFromDefine(agenda, theDefine);
        if (getJobDefineEnabled(theDefine))
            defineAgendaJob(agenda, name, jobDefine.jobFunc);
    });
};
exports.findJobDefineByName = function (jobName) {
    return _agendaJobRegistry[jobName];
};