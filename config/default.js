//var welfareLotteryCodes=["01","05","07","10","13"];
_ = require("lodash");

var jobs = require("./jobs");

var logBaseName = process.env["LOG_BASE"] = process.env.name || 'app';

var logBasePart = __dirname + '/../log/' + logBaseName;

module.exports = {
    mongoDb: {
        url: 'mongodb://localhost/pano-platform',
        useMongooseCache: false,
        useMongooseCacheAfterStart: 3 * 60 * 1000 //启动后N分钟,Cache才生效
    },
    agenda: {
        uiPort: 8889,
        defaultEnabled: false,
        retryInterval: 10 * 1000,
        lotteryDefaultAttempts: 10 * 6, //5 Minutes
        jobDefaultOptions: {
            concurrency: 1,
            lockLifetime: 15 * 1000
        },
        onFailMailTo: "",
        jobs: jobs
    },
    log: {
        src: false, //show source line and file name, ,https://github.com/trentm/node-bunyan#src
        usePrettyStream: true, //process.env("USE-PRETTY-STREAM") https://github.com/mrrama/node-bunyan-prettystream
        default: {
            streams: [
                {
                    level: 'info',
                    stream: 'stdout'  //stdout, stderr            // log INFO and above to stdout
                },
                {
                    level: 'trace',
                    path: logBasePart + '-trace.log'  // log info and above to a file "logs/surespot_#{process.pid}.log"
                },
                {
                    level: 'error',
                    path: logBasePart + '-error.log'  // log ERROR and above to a file
                }
            ]
        },
        req: {
            streams: [
                {
                    level: 'debug',
                    path: logBasePart + '-req-debug.log'  // log info and above to a file "logs/surespot_#{process.pid}.log"
                },
                {
                    level: 'error',
                    path: logBasePart + '-req-error.log'  // log ERROR and above to a file
                }
            ]
        }
    }
}


