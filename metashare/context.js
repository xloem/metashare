// A Context is an object held by a network to hold its local data.
// It can be used to reference the global data.

// is this still needed?
// all it really does is remember the netdbid

module.exports = async function (metashare, id, where = null, name = null, config = null) {
  const ctx = {}

  ctx.metashare = metashare
  // either get our netdbid or make ourselves new

  let net = {}
  let netdbid
  {
    let matchingNets = await metashare.get('net', null, { id: id })
    if (matchingNets.length > 1) {
      throw new Error('duplicate entries for this id in database.')
    }

    net.id = id
    if (where) {
      net.where = where
    }
    if (name) {
      net.name = name
    }
    if (config) {
      if (matchingNets.length === 0) {
        net.cust = { 'config': config }
      } else {
        net.cust = matchingNets[0].cust
        net.cust.config = config
      }
    } else if (matchingNets.length === 0 || !('cust' in matchingNets[0])) {
      net.cust = { 'config': {} }
    } else if (!('config' in matchingNets[0].cust)) {
      net.cust.config = {}
    }

    if (matchingNets.length === 0) {
      if (name === null) {
        net.name = id
      }
      netdbid = await metashare.put('net', null, net)
    } else {
      net.dbid = netdbid = matchingNets[0].dbid
      if (Object.keys(net).length > 1) {
        await metashare.put('net', netdbid, net)
      }
    }

    net = (await metashare.get('net', netdbid))[0]
  }
  ctx.net = net

  ctx.get = async function (type, id) {
    const res = await metashare.get(type, netdbid, { id: id })
    if (res.length === 0) {
      return undefined
    }
    if (res.length > 1) {
      throw new Error('multiple results: should not happen')
    }
    return res[0]
  }
  ctx.put = async function (type, id, object) {
    object.id = id
    await metashare.put(type, netdbid, object)
    if (type === 'post') console.log(object.id + ': ' + object.msg)
    return object
  }
  ctx.getOrPutPlaceholder = async function (type, idOrIds) {
    const existing = await metashare.getPlaceholder(type, netdbid, idOrIds)
    if (existing) {
      return existing.id
    } else {
      if (Array.isArray(idOrIds)) {
        idOrIds = idOrIds[0]
      }
      await metashare.putPlaceholder(type, netdbid, idOrIds)
      return idOrIds
    }
  }
  ctx.getLastFrom = async function () {
    const res = metashare.getLastFrom(netdbid)
    if (res === undefined) return undefined
    if (res.id === id) return undefined
    return res
  }

  return ctx
}

// adding special cases to these functions didn't seem to be the way to go, it really slowed
// progress down in the face of confusion.
// INSTEAD:
//  - either make small new functions
//  - or preferably generalize the needed change and apply concept-wide
//  and test it!
