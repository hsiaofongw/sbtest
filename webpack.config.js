const path = require("path");

module.exports = {
  entry: {
    app: "./src/entry.ts",
    test_ws_cli: "./src/test_ws_cli.ts",
    test_ws_srv: "./src/test_ws_srv.ts",
  },
  devtool: "inline-source-map",
  mode: "production",
  target: "node",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js", ".jsx"],
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
  },
};
