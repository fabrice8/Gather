
type Maintainer = { 
  name: string
  email: string
  homepage?: string
}

export type SearchItem = {
  name: string
  description: string
  url: string
  repository: string
  downloads: number
  favers: number
}
export type SearchResults = {
  results: SearchItem[]
  npage: number
  next?: string
}

export type Package = {
  name: string
  description: string
  keywords?: string[]
  homepage?: string
  authors: Maintainer[]
  require: { [index: string]: string }
  'require-dev': { [index: string]: string }
}
export type PackageWrap = {
  package: {
    name: string
    versions: {
      [index: string]: Package
    }
  }
}