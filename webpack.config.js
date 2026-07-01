const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const fs = require('fs');

// Read version from package.json for manifest injection
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const VERSION = packageJson.version;

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: process.env.NODE_ENV === 'production' ? false : 'inline-source-map',

  entry: {
    // Background service worker
    background: './src/background/background.js',
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'src/background/[name].js',
    clean: false // Don't clean to preserve manually copied files
  },

  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  chrome: '88'
                },
                modules: false
              }]
            ]
          }
        }
      }
    ]
  },

  plugins: [
    new CopyPlugin({
      patterns: [
        // Manifest — inject version from package.json
        {
          from: 'manifest.json',
          to: 'manifest.json',
          transform(content) {
            // Replace version placeholder with actual version from package.json
            const manifest = JSON.parse(content.toString());
            manifest.version = VERSION;
            return JSON.stringify(manifest, null, 2);
          }
        },

        // Source files (non-bundled, loaded as ES modules by the browser).
        // Chrome 91+ natively supports all syntax used; minimum_chrome_version
        // in manifest.json enforces this (MED-025).
        { from: 'src/content', to: 'src/content' },
        { from: 'src/ui', to: 'src/ui' },
        { from: 'src/core', to: 'src/core' },

        // Assets
        { from: 'src/assets', to: 'src/assets', noErrorOnMissing: true },

        // Libraries
        { from: 'libs', to: 'libs', noErrorOnMissing: true },
      ]
    })
  ],

  resolve: {
    extensions: ['.js']
  },

  optimization: {
    minimize: process.env.NODE_ENV === 'production'
  }
};
