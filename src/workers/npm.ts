
import type { Package } from '../types/npm'
import type { Author, DBCollections, Keyword, Publication, Stage } from '../types'
import request from 'request-promise'

const
BREAK_DELAY = 6,
MAX_KEYWORDS_BY_QUEUE = 10,
INITIAL_KEYWORD = 'role',
NPM_BASE_URL = 'https://registry.npmjs.org/-/v1/search?text='

async function searchPackages( keyword: string ): Promise<Package[]> {
  try {
    const
    options = {
      url: NPM_BASE_URL + keyword,
      method: 'GET',
      json: true
    },
    { error, message, objects } = await request( options )
    if( error ) throw new Error( message )

    return objects
  }
  catch( error: any ){ 
    console.log(`Failed search for <${keyword}>: `, error.message )
    return []
  }
}

export default async ( dbc: DBCollections ) => {

  async function saveAuthor( pkg: Package['package'] ){
    
    const publication: Publication = {
      name: pkg.name,
      source: 'npm'
    }

    async function _save( author: Author ){
      // Author email strictly required
      if( !author.email ) return
      console.log(`\t\t----- Saving author <${author.email}>`)

      // Check existing author
      const
      condition = { email: author.email },
      exists = await dbc.Authors.findOne( condition ) as unknown as Author
      if( exists ){
        console.log(`\t\t----- Author Exists <Update>`)

        // This publication is already recorded
        if( exists.publications?.filter( each => { return each.name == pkg.name } ).length )
          return

        // Record new publication of this author
        await dbc.Authors.updateOne( condition, { $push: { publications: publication } } )
        return
      }

      // New author entry
      author.publications = [ publication ]
      await dbc.Authors.insertOne( author )
    }

    // Save author details
    pkg.author && await _save( pkg.author )

    // Save publisher details if different from author
    pkg.author
    && pkg.author.email !== pkg.publisher.email
    && await _save( pkg.publisher )

    // Save each maintainer details if different from author and publisher
    await Promise.all( pkg.maintainers.map( async maintainer => {
      pkg.author?.email !== maintainer.email
      && pkg.publisher.email !== maintainer.email
      && await _save( maintainer )
    }) )
  }

  async function storeKeywords( keywords: string[] ){
    await Promise.all( keywords.map( async value => {
      console.log(`\t\t----- Saving keywords <${value}>`)

      if( await dbc.Keywords.findOne({ value }) ) return
      await dbc.Keywords.insertOne({ value, timestamp: Date.now() } as Keyword )
    } ) )
  }

  async function worker( keywords: Keyword[] ){
    console.log(`-- NPM: NEW JOB [${keywords.length}] keywords --`)

    // Fetch packages by keywords
    await Promise.all( keywords.map( async keyword => {
      // Search packages by keyword
      console.log(`\t\tSearching <${keyword.value}> ...`)
      const packages = await searchPackages( keyword.value )

      console.log(`\t\tPackages [${packages.length}]`)
      if( !packages.length ) return

      // Set on stage keywork
      await dbc.Stages.updateOne({ worker: 'npm' }, { $set: { lastKeyword: keyword } }, { upsert: true })

      await Promise.all( packages.map( async each => {
        // Save author details
        await saveAuthor( each.package )
        // Store keywords for next search
        each.package.keywords
        && await storeKeywords( each.package.keywords )
      } ) )
    } ) )

    console.log('-- NPM: GOING NEXT ... --')

    // Relaunch the worker with next list of keywords
    setTimeout( async () => {
      // Record timestamp where to query the next list of keywords from
      const
      lastTimestamp = keywords.slice(-1)[0].timestamp,
      results = await dbc.Keywords.find({ timestamp: { $gte: lastTimestamp } })
                                  .limit( MAX_KEYWORDS_BY_QUEUE )
                                  .toArray() as unknown as Keyword[]
      if( !results.length ){
        console.log('-- NPM: JOB COMPLETED --')
        return
      }
      
      // Start a job queue
      worker( results )
    }, BREAK_DELAY * 1000 )
  }

  // Initial keywords
  let keywords = [{ value: INITIAL_KEYWORD, timestamp: 0 }]

  // Use previous job's stage keyword
  const stage = await dbc.Stages.findOne({ worker: 'npm' }) as unknown as Stage
  if( stage ) keywords = [ stage.lastKeyword ]

  // Launch worker
  worker( keywords )
}
