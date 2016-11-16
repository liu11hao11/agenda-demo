module.exports = {
    "Hello World": {
        enabled: true,
        alwaysRecreateJob: true,
        repeatEvery:"1 minutes",
        //repeatAt: "120 seconds",
        //schedule: "in 1 seconds",
        //priority?:string; //  highest: 20,    high: 10,    default: 0,    low: -10,    lowest: -20
        data: { content: "Hello World", remainAttempts: 5},
        jobFunc: function (job) {
            return async(function () {
                console.log("hello world");
            })();
        }
    }
};