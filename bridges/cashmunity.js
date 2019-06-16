const fs = require('fs')
const childProcess = require('child_process')

// write credentials from ~/.bitcoin/.cookie to node_modules/config.example
// by replacing content of node_modules/config.example.yaml
//
// then launch node_modules/Cashmunity/server/server.js

module.exports = function (metashareContext) {
  var ret = {}
  // TODO STUB
  var cashmunityProcess
  {
    let networkConfig = metashareContext.networkConfig || (require('os').homedir() + '/.bitcoin')
    let userpass = fs.readFileSync(networkConfig + '/.cookie').toString().split(':')
    let config = fs.readFileSync('node_modules/Cashmunity/config.example.yaml').toString()
    config = config.replace(/BITCOIN_RPC_USER: .*/, 'BITCOIN_RPC_USER: ' + userpass[0])
    config = config.replace(/BITCOIN_RPC_PASSWORD: .*/, 'BITCOIN_RPC_PASSWORD: ' + userpass[1])
    fs.writeFileSync('node_modules/Cashmunity/config.yaml', config)
    try {
      fs.mkdirSync('db')
    } catch (e) {}
  }

  onCashmunityExit(-1)

  function onCashmunityExit (code) {
    cashmunityProcess = childProcess.fork('Cashmunity/server/server')
    cashmunityProcess.on('exit', onCashmunityExit)
  }

  return ret
}
