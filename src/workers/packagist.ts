
import type { Package, PackageWrap, SearchResults } from '../types/packagist'
import type { Author, DBCollections, Keyword, Publication, Stage } from '../types'
import request from 'request-promise'

const INITIAL_KEYWORD = 'symfony'

async function searchPackages( keyword: string, page?: number ): Promise<SearchResults> {
  try {
    if( !process.env.PACKAGIST_BASE_URL )
      throw new Error('Undefined Packagist base URL')

    const url = new RegExp( process.env.PACKAGIST_BASE_URL as string ).test( keyword ) ?
                              keyword // Assign next page URL as keyword
                              : `${process.env.PACKAGIST_BASE_URL}/search.json?q=${keyword +( page ? '&page='+ page : '' )}`

    const
    options = {
      url,
      method: 'GET',
      json: true
    },
    { error, message, results, total, next } = await request( options )
    if( error ) throw new Error( message )

    return { 
      results,
      npage: Math.round( total / (results.length || 1 ) ),
      next
    }
  }
  catch( error: any ){
    console.log(`Failed search for <${keyword}>: `, error.message )
    return { results: [], npage: 0 }
  }
}

async function getPackage( url: string ): Promise<Package | null> {
  try {
    if( !process.env.PACKAGIST_BASE_URL )
      throw new Error('Undefined Packagist base URL')

    // Invalid package URL
    if( !url.includes( process.env.PACKAGIST_BASE_URL as string ) ) return null
    
    const
    options = {
      url: `${url}.json`,
      method: 'GET',
      json: true
    },
    response = await request( options )
    if( response.error ) throw new Error( response.message )

    return Object.values( (response as PackageWrap).package.versions )[0]
  }
  catch( error: any ){
    console.log(`Failed getting package from <${url}>: `, error.message )
    return null
  }
}

export default async ( dbc: DBCollections ) => {

  async function saveAuthor( pkg: Package ){
    
    const publication: Publication = {
      name: pkg.name,
      source: 'packagist'
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
    
    // Save each maintainer details if different from author and publisher
    Array.isArray( pkg.authors )
    && pkg.authors.length
    && await pkg.authors.pmap( async each => each.email && await _save( each ) )
  }

  async function storeKeywords( keywords: string[] ){
    await keywords.pmap( async value => {
      console.log(`\t\t----- Saving keywords <${value}>`)

      if( await dbc.Keywords.findOne({ value }) ) return
      await dbc.Keywords.insertOne({ value, timestamp: Date.now() } as Keyword )
    } )
  }

  async function worker( keywords: Keyword[] ){
    console.log(`-- PACKAGIST: NEW JOB [${keywords.length}] keywords --`)

    // Fetch packages by keywords
    await keywords.pmap( async keyword => {

      async function _all( str: string ){
        // Search packages by keyword
        console.log(`\t\tSearching <${str}> ...`)
        const { results, npage, next } = await searchPackages( str )
        if( !results ) return

        // List of package from all pages
        const packages: Package[] = []
        await results.pmap( async ({ url }) => {
          const pkg = await getPackage( url )
          if( !pkg ) return

          packages.push( pkg )
        } )
        
        console.log(`\t\tPackages [${packages.length}]`)
        if( !packages.length ) return

        // Set on stage keywork
        await dbc.Stages.updateOne({ worker: 'packagist' }, { $set: { lastKeyword: keyword } }, { upsert: true })

        await packages.pmap( async each => {
          // Save author details
          await saveAuthor( each )
          // Store keywords for next search
          each.keywords
          && await storeKeywords( each.keywords )
        } )

        // Fetch next page items
        if( next ){
          console.log(`\t\tPagination: Total pages [${npage}] - Next <${next}> ...`)
          await _all( next )
        }
      }

      // Get all packages by recuring through all pagination possible
      await _all( keyword.value )
    } )

    console.log('-- PACKAGIST: GOING NEXT ... --')

    // Relaunch the worker with next list of keywords
    setTimeout( async () => {
      // Record timestamp where to query the next list of keywords from
      const
      lastTimestamp = keywords.slice(-1)[0].timestamp,
      results = await dbc.Keywords.find({ timestamp: { $gte: lastTimestamp } })
                                  .limit( Number( process.env.MAX_KEYWORDS_BY_QUEUE ) || 10 )
                                  .toArray() as unknown as Keyword[]
      if( !results.length ){
        console.log('-- PACKAGIST: JOB COMPLETED --')
        return
      }
      
      // Start a job queue
      worker( results )
    }, (Number( process.env.PACKAGIST_BREAK_DELAY ) || 8) * 1000 )
  }

  // Initial keywords
  let keywords = [{ value: INITIAL_KEYWORD, timestamp: 0 }]

  // Use previous job's stage keyword
  const stage = await dbc.Stages.findOne({ worker: 'packagist' }) as unknown as Stage
  if( stage ) keywords = [ stage.lastKeyword ]

  // Launch worker
  worker( keywords )
}
