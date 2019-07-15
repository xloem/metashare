const Metashare = require('../metashare/metashare')
const Ctx = require('../metashare/context')
const Bitcoin = require('../bridges/bitcoin')

const assert = require('assert')

const os = require('os')

// describe('bsv live', () => {
// describe('bch regtest live', () => {
// describe('bsv stn live', () => {
describe('bch live', () => {
  var metashare = null
  var bitcoin = null
  before(async function () {
    this.timeout(60000)
    metashare = await Metashare()
    // let ctx = await Ctx(metashare, 'Bitcoin SV', os.homedir() + '/.bitcoin.sv', 'Bitcoin Satoshi Vision')
    // let ctx = await Ctx(metashare, 'Bitcoin Cash/regtest', os.homedir() + '/.bitcoin.cash/regtest')
    // let ctx = await Ctx(metashare, 'Bitcoin SV STN', os.homedir() + '/.bitcoin.sv/stn', 'Bitcoin Satoshi Vision Scaling Test Network')
    let ctx = await Ctx(metashare, 'Bitcoin Cash', os.homedir() + '/.bitcoin.cash')
    bitcoin = await Bitcoin(ctx)
  })
  it('constructs', async () => {
    assert(bitcoin !== null)
  })
  it('syncs', async () => {
    await bitcoin.sync()
  }).timeout(60 * 60000)
  after(async () => {
    await metashare.destroy()
  })
})

if (run) run()
