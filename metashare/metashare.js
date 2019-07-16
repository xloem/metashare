const Knex = require('knex')

module.exports = async function (dbconfig = {
  client: 'sqlite3',
  connection: {
    filename: 'db/metashare.sqlite'
  }
}) {
  const metashare = {}

  if (dbconfig.client === 'sqlite3') { dbconfig.useNullAsDefault = true }

  const knex = Knex(dbconfig)

  if (dbconfig.client === 'sqlite3') { await knex.raw('PRAGMA journal_mode=WAL;') }

  const typeNames = ['net', 'user', 'prof', 'post', 'topic', 'opin']

  // =====================================================================
  // In order to copy values between nodejs objects and the database,
  // the database structure itself is used as the model definition.
  //
  // metashare.types() lists the object types (i.e. table names)
  // metashare.schema(type) lists the object attributes (i.e. table columns)
  //
  // To change them, modify the database schema creation logic below.
  //
  // Specific symbology is used to ease introspection:
  // '@' indicates the field references another table.
  //    Text to the right is the table.  Text to the left is treated as the fieldname, if present.
  // '$' indicates a field contains the name of a table.
  //
  // Additionally, all objects have attributes of the 'item' table:
  // - 'id' a required network-specific id
  // - 'cust' optional json data
  // ======================================================================

  if (!await knex.schema.hasTable('item')) {
    await knex.schema.createTable('item', function (table) {
      table.comment('Network-local items, one for each.  Details are stored in separate tables under detail dbid@item')
      table.increments('dbid@item')
      table.integer('detail@$type').unsigned().references('dbid@item').inTable('item')
        .comment('Index in item details table.')
      table.integer('@net').unsigned().notNullable().references('dbid@item').inTable('net')
      table.string('id').notNullable()
        .comment('Should be the most obvious string, to reduce clashing between independent bridge implementations.  Choose capitalization and whole name of original first choice UUID made by creator.')
      table.enu('$type', typeNames)
        .comment('Table to find item details in.')
      table.unique(['@net', '$type', 'id'])
      table.unique(['@net', 'detail@$type'])
      table.jsonb('cust')
        .comment('network-local data')
    })
  }
  if (!await knex.schema.hasTable('net')) {
    await knex.schema.createTable('net', function (table) {
      table.comment('Net detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=net')
      table.timestamp('time', { useTz: false })// .notNullable()
      table.string('name')
      table.string('where')
    })
  }
  if (!await knex.schema.hasTable('priv')) {
    await knex.schema.createTable('priv', function (table) {
      table.comment('Holds private user information to be shared only with them.')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=user')
      table.jsonb('priv')
        .comment('private key material etc')
    })
  }
  if (!await knex.schema.hasTable('user')) {
    await knex.schema.createTable('user', function (table) {
      table.comment('User detail table -- see prof for real details')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=user')
      table.timestamp('time', { useTz: false }).notNullable()
    })
  }
  if (!await knex.schema.hasTable('prof')) {
    await knex.schema.createTable('prof', function (table) {
      table.comment('Profile detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=prof')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.enu('attr', ['name', 'about', 'picurl']) // be sure to update ENUM HACK below
      table.string('val')
    })
  }
  if (!await knex.schema.hasTable('post')) {
    await knex.schema.createTable('post', function (table) {
      table.comment('Post detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=post')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.integer('reply@post').unsigned().references('dbid@item')
      table.integer('@topic').unsigned().references('dbid@item').inTable('topic')
      table.integer('share@post').unsigned().references('dbid@item')
      table.string('msg')
    })
  }
  if (!await knex.schema.hasTable('topic')) {
    await knex.schema.createTable('topic', function (table) {
      table.comment('Topic detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=topic')
      table.timestamp('time', { useTz: false })
      table.string('name')
    })
  }
  if (!await knex.schema.hasTable('opin')) {
    await knex.schema.createTable('opin', function (table) {
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=opin')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.integer('what@item').unsigned().notNullable().references('dbid@item').inTable('item')
      table.enu('how', ['like', 'follow', 'tip']) // be sure to update ENUM HACK below
      table.float('value').notNullable()
        .comment('>0 for specifying, <=0 for reverting')
      table.string('unit')
    })
  }

  const schemas = {}
  for (let typename of typeNames) {
    const colsRef = {}
    const colsNonref = {}
    const typeColumnInfo = await knex(typename).columnInfo()
    for (let column in typeColumnInfo) {
      const parts = column.split('@', 2)
      if (parts.length < 2) {
        colsNonref[column] = {
          col: column,
          name: column,
          type: typeColumnInfo[column].type,
          optional: typeColumnInfo[column].nullable
        }
      } else {
        if (parts[0] === 'dbid') continue // primary key ref kept implicit
        colsRef[parts[0] || parts[1]] = {
          col: column,
          name: parts[0] || parts[1],
          type: parts[1],
          optional: typeColumnInfo[column].nullable
        }
      }
    }
    schemas[typename] = {
      refs: colsRef,
      vals: colsNonref
    }
  }
  // ENUM HACK
  schemas.prof.vals.attr.type = 'enum'
  schemas.prof.vals.attr.enums = ['name', 'about', 'picurl']
  schemas.opin.vals.how.type = 'enum'
  schemas.opin.vals.how.enums = ['like', 'follow', 'tip']

  metashare.types = () => typeNames.slice()
  metashare.schema = (type) => schemas[type]

  metashare.MissingItemError = function (msg, type, id) {
    this.stack = Error().stack
    this.message = msg
    this.type = type
    this.id = id
  }
  metashare.MissingItemError.prototype = Object.create(Error.prototype)
  metashare.MissingItemError.prototype.constructor = metashare.MissingItemError
  metashare.MissingItemError.prototype.name = 'MissingItemError'

  // TODO: provide for censorship option?  to allow karl to continue work more easily
  //    we believe karl can resist inhibition and would like more rapid aid
  //    karl reports he is really worn out with regard to internal mediation
  //    and he would like to just struggle to work, and is happy to pursue whichever
  //    path kind of ends up influencing him
  //  2 options: mark item as censored
  //    OR: convert item to hash so is not even in database, but can be recognized,
  //      and then mark as censored
  //
  //  we're thinking as this reaches a point of actual workability, so will the choices
  //  made in its design.  sw is far cry from functioning atm and will likely need some more
  //  redesign to actually work, due to how _much_ data there will be to process.
  //    to confirm, the approach of this sw design does not accomodate the amount of
  //    data it is expected to encounter, even on startup.
  //      karl is an experienced coder and enjoys working through problems as
  //      they happen
  //
  // =====================================================================================
  //  censorship provides for metaneeds.  (things we avoid for now to move conflict
  //    resolution forward in the face of mistrust or privacy)
  //  if we can formalize an agreeable depiction of metaneeds, it should align as a
  //  feature to include.
  // =====================================================================================
  //  Censorship plan:
  //    Networks can hold messages stating a request to censor a word or pattern.
  //    These messages can be made in ways that are hard to see, or public, but somehow they can be made.
  //        ^-- for expense, likely provide for it being unreasonable to recover what is being censored
  //    Finances must be provided to back the request (likely very small at first) to discourage
  //      wanton censorhip.
  //    System analyzes what will be censored as a result of request, and only censors
  //    these things if enough is paid to match a formula that increases as
  //      inverse 50% of total item count - number of items censored.
  //    such that it hits infinity once 50% of all things are censored
  //      TODO: update formula so it cannot be gamed by making multiple requests.
  //          likely by using total of all censored items, rather than just requested ones.
  //
  //    Missing ideas:
  //      - consider approach of running things by people who are trusted by censors
  //           (would it work to ask them to engage the network transparently to the community.
  //             if we asked them to hide their secrets in a different way?
  //             they of course would have their own privacy in order to plan this)
  //          propose both approaches: run a public filter, or censor a pattern.  could consolidate censorship patterns into a public filter we provide for use if desired.
  //      - propose paying censor filter developers with censorship profits?
  //      - time limit to censorship (maybe could be implicit in frequency of discussing topic?)  or dcould use similar price scale with max of 100 years or somesuch (price hits infinity at max)
  //      - moving censorship from one pattern to another by outbidding
  // =====================================================================================
  // feature seems fine to me, would make me money
  //    not my ideal behavior, censoring people, but I can get on board with it
  //
  //  expect to check for these requests within the core components of library, so as to allow them
  //  coming from arbitrary channels
  //  will need to add financial information to database content
  //        so this makes karl (and whoever runs a mirror or joins karl's community) money
  //        and it helps people with secrets keep their secrets
  //
  //        the exchange is hopefully ease in making this software, so that disparate communities can
  //        share stored information more readily
  //            information that is not censored, or communication that provides for dealing with
  //            the concerns resulting in censorship

  // Call get() to retrieve objects.  The object fields will be filled relative to the
  // provided netdbid.  If netdbid is null, objects will be retrieved for the network
  // that produced them.  Only objects with the provided fields are returned.
  // An array of objects is returned:
  // [ {
  //     dbid: unique_number_for_object,
  //     id: 'network local id',
  //     cust: {optional network-specific data},
  //     origid: 'id in network that produced object',
  //     orignetid: 'id of network that produced object',
  //     ... type-specific schema fields ...
  //   },
  //   ...
  // ]
  metashare.get = async (type, netdbid = null, fields = {}, limit = 0, reverseOrder = false, trx = knex) => {
    const schema = schemas[type]
    const selection = [
      'item.detail@$type as dbid',
      'item.id',
      'item.cust',
      'orig.id as origid',
      'orignet.id as orignetid'
    ]
    for (let col of Object.values(schema.vals)) {
      selection.push(type + '.' + (col.name === col.col ? col.name : col.col + ' as ' + col.name))
    }
    for (let colref of Object.values(schema.refs)) {
      selection.push(colref.name + '.id as ' + colref.name)
    }
    if (type === 'user') {
      selection.push('priv.priv')
    }
    var items = trx('item')
      .select(selection)
      .join(type, 'item.detail@$type', type + '.dbid@item')
      .join({ orig: 'item' }, 'item.detail@$type', 'orig.dbid@item')
      .join({ orignet: 'item' }, 'orig.@net', 'orignet.dbid@item')
    for (let colref of Object.values(schema.refs)) {
      const _table = {}
      _table[colref.name] = 'item'
      const _join = {}
      _join[colref.name + '.detail@$type'] = type + '.' + colref.col
      _join[colref.name + '.@net'] = 'item.@net'
      if (colref.optional) { items = items.leftJoin(_table, _join) } else { items = items.join(_table, _join) }
    }
    if (type === 'user') {
      items = items
        .leftJoin('priv', 'item.dbid@item', 'priv.dbid@item')
    }
    items = items
      .where('item.$type', type)
    if (netdbid === null) {
      items = items
        .andWhere('item.dbid@item', knex.ref('item.detail@$type'))
    } else {
      items = items
        .andWhere('item.@net', netdbid)
    }
    if ('dbid' in fields) {
      items = items
        .andWhere('dbid', fields.dbid)
    }
    if ('id' in fields) {
      items = items
        .andWhere('item.id', fields.id)
    }
    for (let col of Object.values(schema.vals)) {
      const field = fields[col.name]
      if (field === undefined) continue
      items = items
        .andWhere(knex.ref(col.col).withSchema(type),
          knex.ref(field))
    }
    for (let colref in schema.refs) {
      const id = fields[colref.name]
      if (id === undefined) continue
      items = items
        .andWhere(colref.name + '.id', knex.ref(id))
    }

    if (limit) items = items.limit(limit)
    items = items.orderBy('dbid', reverseOrder ? 'desc' : 'asc')

    items = await items

    // process json and null
    const vals = Object.values(schema.vals).concat(Object.values(schema.refs))
    vals.push({ type: 'json', name: 'cust', optional: true })
    if (type === 'user') { vals.push({ type: 'json', name: 'priv', optional: true }) }
    for (let item of items) {
      for (let val of vals) {
        if (item[val.name] === null) { delete item[val.name] } else if (val.type === 'json') { item[val.name] = JSON.parse(item[val.name]) }
      }
    }

    return items
  }

  metashare.getPlaceholder = async (type, netdbid, id) => {
    return knex('item')
      .first('detail@$type as dbid')
      .where('id', id)
      .andWhere('@net', netdbid)
      .andWhere('$type', type)
  }

  metashare.putPlaceholder = async (type, netdbid, id) => {
    console.log('WARNING: making placeholder in ' + netdbid + ' for ' + type + ' ' + id)
    return knex.transaction(async (trx) => {
      const dbid = (await trx('item')
        .insert({
          '@net': netdbid,
          id: id,
          '$type': type
        }))[0]
      await trx('item')
        .update({ 'detail@$type': dbid })
        .where('dbid@item', dbid)
      return dbid
    })
  }

  metashare.getLastFrom = async (netdbid) => {
    const fields = await knex('item')
      .first(['dbid@item as dbid', 'id', '$type as type'])
      .where('@net', netdbid)
      .andWhere('dbid', knex.ref('detail@$type'))
      .orderBy('dbid', 'desc')
    if (fields === undefined) return fields
    const res = (await metashare.get(fields.type, netdbid, fields))[0]
    res.type = fields.type
    return res
  }

  // Call put() when the provided network creates a new object.
  // May also be used to create new networks by providing netdbid = null
  // Networks may be passed to this call multiple times to update them.
  // Other objects may only have their 'cust' field updated.
  // object:
  //    {
  //      id: "required",
  //      cust: { /* optional network-local subobj data */ },
  //      .. any type-specific fields
  //    }
  // A .dbid field will be added to object.
  // The dbid is additionally returned by the put function.
  metashare.put = async (type, netdbid, object) => {
    const schema = schemas[type]
    await knex.transaction(async (trx) => {
      async function makeDetails (object) {
        const details = {}
        if (object.dbid) {
          details['dbid@item'] = object.dbid
        }
        for (let colnonref of Object.values(schema.vals)) {
          if (colnonref.name in object) {
            if (colnonref.type === 'json') {
              details[colnonref.col] = JSON.stringify(object[colnonref.name])
            } else {
              details[colnonref.col] = object[colnonref.name]
            }
          }
        }
        for (let colref of Object.values(schema.refs)) {
          if (colref.name in object) {
            let req = trx('item')
              .first('dbid@item')
              .where('id', object[colref.name])
              .andWhere('@net', netdbid)
            if (colref.type !== 'item') {
              req = req
                .andWhere('$type', colref.type)
            }
            let res = await req
            if (!res) {
              // referenced item does not exist.  make a placeholder item until it is inserted?
              throw new metashare.MissingItemError('referenced ' + colref.name + ' does not exist: ' + colref.type + ' ' + object[colref.name] + ' (PUT ' + type + ' into ' + netdbid + ': ' + JSON.stringify(object) + ')', colref.type, object[colref.name])
            } else {
              details[colref.col] = res['dbid@item']
            }
          }
        }
        return details
      }

      let itemreq = trx('item')
        .select(['dbid@item as dbid', 'detail@$type as origdbid'])
        .where(function () {
          this.where('$type', type)
        })
        .andWhere('id', object.id)
      if (netdbid) {
        itemreq = itemreq
          .andWhere('@net', netdbid)
      } else {
        itemreq = itemreq
          .andWhere('dbid', knex.ref('detail@$type'))
      }

      itemreq = await itemreq
      if (itemreq.length > 1) { throw new Error('database contains duplicate id') }

      // console.log('itemreq res: ' + itemreq)
      if (itemreq.length === 1 &&
          (await trx(type).select('dbid@item as dbid').where('dbid@item', itemreq[0].dbid)).length > 0) {
        let existing = {}
        if (type === 'net') {
          object.dbid = itemreq[0].dbid
          await trx(type)
            .update(await makeDetails(object))
            .where('dbid@item', object.dbid)
        } else {
          existing = (await metashare.get(type, netdbid, { id: object.id }, 0, false, trx))
          console.log('EXISTING: ' + existing)
          existing = existing[0]
        }

        for (let field in object) {
          if (field !== 'cust') {
            // tried to recreate existing item
            if (type === 'net') continue
            if (object[field] === existing[field]) continue
            throw new Error('id is not unique and new[' + field + ']=' + JSON.stringify(object[field]) + ' != old[' + field + ']=' + JSON.stringify(existing[field]) + ' (PUT ' + type + ' into ' + netdbid + ': ' + JSON.stringify(object) + ')')
          }
          // field === 'cust'
          await trx('item')
            .update({ cust: JSON.stringify(object.cust) })
            .where('dbid@item', object.dbid)
        }

        return
      }

      // item is new

      const update = {}
      if (itemreq.length === 0) {
        // no placeholder item to fill in
        object.dbid = (await trx('item')
          .insert({
            '@net': netdbid || 0,
            'detail@$type': null,
            id: object.id,
            '$type': type,
            cust: object.cust && JSON.stringify(object.cust)
          }))[0]
      } else {
        // filling in placeholder item
        console.log('RESOLVED: found content for ' + type + ' ' + object.id)
        object.dbid = itemreq[0].dbid
        // update['$type'] = type
      }
      update['detail@$type'] = object.dbid
      if (type === 'net') { update['@net'] = object.dbid }
      await trx('item').update(update).where('dbid@item', object.dbid)
      await trx(type).insert(await makeDetails(object))
      if (type === 'user' && 'priv' in object) {
        await trx('priv').insert({
          'dbid@item': object.dbid,
          'priv': JSON.stringify(object.priv)
        })
      }
    })

    // TODO: send onwards to all other networks? (this function is called whenever new object generated)

    return object.dbid
  }

  // Call mirror() to mirror an object onto a new network.
  // Current assumption is that this called for all objects, so that they may be referenced by local id.
  // object:
  // {
  //    id: "required id for this network"
  //    cust: { optional network-specific data }
  // }
  // A dbid field is added to object, but it just contains the passed dbid value.
  metashare.mirror = async (type, netdbid, dbid, object) => {
    await knex('item')
      .insert({
        '@net': netdbid,
        'detail@$type': dbid,
        id: object.id,
        '$type': type,
        cust: object.cust && JSON.stringify(object.cust)
      })
    object.dbid = dbid
  }

  metashare.destroy = async () => {
    await knex.destroy()
  }

  let runPromise = null
  let running = false

  // Mirrors messages until .stop() is called
  metashare.run = async () => {
    if (running) throw new Error('already running')
    running = true
    runPromise = new Promise((resolve, reject) => {
      // TODO STUB
      // we'll want a loop for every network
      // and to start new loops when new networks are created
      // we can track where we are with dbids
    })
    return runPromise
  }

  metashare.stop = async () => {
    running = false
    return runPromise
  }

  return metashare
}

// TODO: track & mirror networks.
//   mirroring: check using database last unmirrored network
//   mirror remaining networks.
