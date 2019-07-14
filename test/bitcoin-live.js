const Metashare = require('../metashare/metashare')
const Ctx = require('../metashare/context')
const Bitcoin = require('../bridges/bitcoin')

const assert = require('assert')

const os = require('os')

// describe('bsv live', () => {
describe('bch regtest live', () => {
  var metashare = null
  var bitcoin = null
  before(async () => {
    console.log('premeta')
    metashare = await Metashare()
    console.log('postmeta')
    // let ctx = await Ctx(metashare, 'Bitcoin SV', os.homedir() + '/.bitcoin.sv', 'Bitcoin Satoshi Vision')
    let ctx = await Ctx(metashare, 'Bitcoin Cash/regtest', os.homedir() + '/.bitcoin.cash/regtest')
    bitcoin = await Bitcoin(ctx)
  })
  it('constructs', async () => {
    assert(bitcoin !== null)
  }).timeout(60000)
  it('syncs', async () => {
    await bitcoin.sync()
  })
  after(async () => {
    await metashare.destroy()
  })
})

if (run) run()
