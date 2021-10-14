// Generated using webpack-cli https://github.com/webpack/webpack-cli

const path = require("path");

const isProduction = process.env.NODE_ENV == "production";

const config = {
    entry: "./src/index.js",
    output: {
        filename: "pouchdb-browser.js",
        path: path.resolve(__dirname, "dist"),
        library: {
            type: "module",
        },
    },
    experiments: {
        outputModule: true,
    },
    plugins: [],
    module: {},
};

module.exports = () => {
    if (isProduction) {
        config.mode = "production";
    } else {
        config.mode = "development";
    }
    return config;
};
