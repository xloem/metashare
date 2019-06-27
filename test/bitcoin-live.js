const Metashare = require('../metashare/metashare')
const Ctx = require('../metashare/context')
const Bitcoin = require('../bridges/bitcoin')

const assert = require('assert')

const os = require('os')

async function setup () {
  var metashare = await Metashare()
  var ctx = await Ctx(metashare, 'Bitcoin SV', os.homedir() + '/.bitcoin.sv', 'Bitcoin Satoshi Vision')
  var bitcoin = await Bitcoin(ctx)

  describe('bsv live', async () => {
    await bitcoin.sync()
    assert(true)
  })

  run()
}

setup()
