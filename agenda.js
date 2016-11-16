var lib = require("./lib/index");
var config = require("config");
var Agenda = require('agenda');
var agenda = new Agenda({ db: { address: config.mongoDb.url }, processEvery: '10 seconds' }, function() {
    // Should add this code before setting middleware.
    agenda._db = agenda._collection;
    app.use('/agenda-ui/', agendaUI(agenda, {poll: 1000}));
});
var path = require("path");
var log=lib.getLogger("agenda")

var mongoose = require("mongoose");
if (!mongoose.connection)
    mongoose.connect(config.mongoDb.url);

var updateAgendaDbAsync = function (finder, updater, options) {
    return new Promise(function (resolve, reject) {
        agenda._collection.update(finder, updater, options, function (err, rst) {
            if (err)
                reject(err);
            else
                resolve(rst);
        });
    });
};
var doAfterInitData = function () {
    //lib.createAgendaJobDefineFromRegistry(agenda);
    lib.recreateAgendaJobsFromConfig(agenda);
    var findJobDefine = function (job) {
        var jobName = job && job.attrs && job.attrs.name;
        if (jobName) {
            return lib.findJobDefineByName(jobName);
        }
    };
    agenda.on('start', function (job) {
        var fromAgendaNow = (job.attrs.data && job.attrs.data.isAgendaNowJob) ? "isAgendaNowJob:true" : "";
        log.info("Job %s 触发", job.attrs.name, fromAgendaNow);
        var jobDefine = findJobDefine(job);
        if (!jobDefine)
            return;
        //log.info("Job %s 触发, data", job.attrs.data);
        var at = new Date();
        if (job.attrs.data) {
            if (job.attrs.data.remainAttempts === 0) {
                job.attrs.data.remainAttempts = jobDefine.data.remainAttempts;
                job.attrs.data.attempts = undefined;
            }
        }
    });
    agenda.on('complete', function (job) {
        if (job.attrs && job.attrs.data && job.attrs.data.log_id) {
            var logData = _.extend(_.cloneDeep(job.attrs.data), _.pick(job.attrs, "failedAt", "failReason"));
            delete logData.log_id;
            //log.info("complete",job.attrs.name,logData);
            lotteryMod.AgendaJobLog.update({ _id: job.attrs.data.log_id }, {
                data: logData,
                completedAt: new Date()
            }).exec();
        }
        //删除 RetryNow 执行的 agenda.now创建在数据库里的Job,
        if (job.attrs && job.attrs.data && job.attrs.data.isAgendaNowJob && !job.attrs.nextRunAt) {
            job.remove(function (err) {
                if (err) {
                    log.error("Remove isAgendaNowJob Error", err);
                }
                else {
                    log.info("Remove isAgendaNowJob job", job.attrs);
                }
            });
        }
    });
    agenda.on('success', function (job) {
        return async(function () {
            log.info("Job %s 成功", job.attrs.name);
            delete job.attrs.failedAt;
            delete job.attrs.failReason;
            var jobDefine = findJobDefine(job);
            if (!jobDefine)
                return;
            if (job.attrs.data) {
                job.attrs.data.remainAttempts = jobDefine.data.remainAttempts;
                job.attrs.data.attempts = undefined;
            }
            // fix agenda bug, failed reason will always exists
            await(updateAgendaDbAsync({ _id: job.attrs._id }, { $unset: { failedAt: 1, failReason: 1 } }));
        })();
    });
    agenda.on('fail', function (err, job) {
        return async(function () {
            if (err) {
                var errStr = lib.format("Job %s 失败", job.attrs.name, err);
                if (job.attrs.data && job.attrs.data.remainAttempts)
                    errStr = lib.format("No. %d attempts: " + errStr, job.attrs.data.attempts || 1);
                log.error(errStr);
            }
            var data = _.cloneDeep(job.attrs.data || {});
            if (_.isUndefined(data.remainAttempts))
                return;
            data.remainAttempts--;
            if (data.remainAttempts > 0) {
                data.attempts = (data.attempts + 1) || 2;
                job.attrs.data = data;
                job.attrs.nextRunAt = moment().add(config.agenda.retryInterval, "ms").toDate();
                var nextRunAt = moment().add(config.agenda.retryInterval, "ms").toDate();
                await(updateAgendaDbAsync({ _id: job.attrs._id }, { $set: { nextRunAt: nextRunAt, data: data } }));
            }
            else {
                var jobDefine = findJobDefine(job);
                if (!jobDefine)
                    return;
                if (data.attempts > 0 && data.remainAttempts <= 0) {
                    job.attrs.data = data;
                    await(updateAgendaDbAsync({ _id: job.attrs._id }, { $set: { data: data } }));
                }
                emailFailedJob(jobDefine, err);
            }
        })();
    });
    doStartAgenda();
};
var doStartAgenda = function () {
    return async(function () {
        await(Promise.delay(5 * 1000));
        agenda.start();
        agenda.jobs({ nextRunAt: null, repeatAt: { $exists: true } }, function (err, jobs) {
            if (err) {
                return log.error("{nextRunAt:null,repeatAt:{$exists:true} }的计划任务重新设定nextRunAt失败", err);
            }
            jobs.forEach(function (job) {
                log.warn("发现缺少nextRunAt的Job, 重新设定nextRunAt", job.attrs.name);
                job.computeNextRunAt();
                job.save();
            });
        });
        await(Promise.delay(10 * 1000));
        var retryFailedJob = function (err, jobs) {
            if (err) {
                return log.error("重新执行失败的计划任务", err);
            }
            jobs.forEach(function (job) {
                log.info("重新执行失败的计划任务", job.attrs.name);
                job.run(function (err, theJob) {
                    if (err)
                        log.error(theJob && theJob.attrs.name, "job.run", err);
                });
            });
        };
        agenda.jobs({ failedAt: { $exists: true }, "data.remainAttempts": 0 }, retryFailedJob);
        //nextRunAt是现在的1小时以后，只对彩种相关的定时任务执行
        agenda.jobs({ failedAt: { $exists: true }, "data.remainAttempts": { $gt: 0 }, "data.lotteryCode": { $exists: true }, "nextRunAt": { $gt: moment().add(1, "hour").toDate() } }, retryFailedJob);
    })();
};
function emailFailedJob(jobDefine, err) {
    var isErrObj = (err instanceof Error);
    var mailTo = config.agenda.onFailMailTo;
    if (jobDefine.onFailMailTo)
        mailTo = jobDefine.onFailMailTo;
    if (!mailTo)
        return;
    if (isErrObj) {
        lib.sendEmail({
            to: mailTo,
            subject: _s.sprintf("Job failed [%s] Error:%s", jobDefine.name, err.message),
            text: err.message + "\n" + err.stack
        });
    }
    else {
        lib.sendEmail({
            to: mailTo,
            subject: _s.sprintf("Job failed [%s]", jobDefine.name),
            text: JSON.stringify(err, null, 4)
        });
    }
}
function graceful() {
    agenda.stop(function () {
        process.exit(0);
    });
}
_.delay(function () {
    log.info("doAfterInitData");
    doAfterInitData();
}, 5 * 1000); //delay 5s to reduce the chance of "mongo dead lock"
process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
//////////////////////////////////////////agenda UI ////////////////////////////////////////////
var express = require('express');
//var logger = require('morgan');
var app = express();

var agendaUI = require('agenda-ui');
var bodyParser = require('body-parser');
app.use(require('express-bunyan-logger')(lib.getReqLoggerOpt()));
app.use(require('express-validator')());
app.use(bodyParser.json());


app.post('/retryJobNow', function (req, res) {
    return async(function () {
        log.info("立即手工重试计划任务", req.body);
        var jobName = req.body.job_name;
        var extraData = req.body.data;
        req.assert('job_name', '计划任务的名称[job_name]不能为空').notEmpty();
        var errors = req.validationErrors();
        if (errors) {
            return res.status(400).send(errors);
        }
        var jobName = req.body.job_name;
        agenda.jobs({ name: jobName }, function (err, jobs) {
            if (err) {
                return res.status(400).send({ err: err, name: jobName });
            }
            if (jobs.length < 1) {
                return res.status(400).send({ err: "找不到该定时任务", name: jobName });
            }
            if (jobs.length > 1) {
                return res.status(400).send({ err: "存在多个同名的定时任务", name: jobName });
            }
            var job = jobs[0];
            //log.info("retryJob",job);
            var theData = _.cloneDeep(job.attrs.data);
            if (theData) {
                theData = _.extend(theData, extraData);
                theData.remainAttempts = undefined;
                theData.attempts = undefined;
                theData.isAgendaNowJob = true;
            }
            agenda.now(jobName, _.extend({ isAgendaNowJob: true }, theData));
            return res.status(200).send({ at: new Date() });
        });
    })();
});
/*agenda._db = agenda._collection;
app.use('/agenda-ui', agendaUI(agenda, { poll: false }));*/
app.get('/', function (req, res) {
    log.info('app get / redirect to /jobs/agenda-ui');
    res.redirect("/agenda-ui");
});
app.listen(10000)
module.exports = app;