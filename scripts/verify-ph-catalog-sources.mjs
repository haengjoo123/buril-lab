import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const commit = 'cafc3530d40c7b098ebb9c32f56383ccba6a3856'
const sources = [
  {
    id: 'phreeqc.dat',
    url: `https://raw.githubusercontent.com/phreeqc-dev/phreeqc3/${commit}/database/phreeqc.dat`,
    sha256: 'c0f7a13b5bb2b5b6e1251953f57292e993ff0850f3c01782d23094f24ae2d499',
  },
  {
    id: 'wateq4f.dat',
    url: `https://raw.githubusercontent.com/phreeqc-dev/phreeqc3/${commit}/database/wateq4f.dat`,
    sha256: '93547b0343d9f151e73fb48e7927aa9e9c777399fedcb8c7497d00371af4d0ae',
  },
  {
    id: 'minteq.v4.dat',
    url: `https://raw.githubusercontent.com/phreeqc-dev/phreeqc3/${commit}/database/minteq.v4.dat`,
    sha256: '4a48bf5c357b3da3084606a5e322426c3ab1e969dd1c86f9c62a3a7995836ca3',
    markers: [
      'H+ + Acetate- = H(Acetate)',
      'log_k 4.757',
      'H+ + Formate- = H(Formate)',
      'log_k 3.745',
      'H+ + Propionate- = H(Propionate)',
      'log_k 4.874',
      'H+ + Butyrate- = H(Butyrate)',
      'log_k 4.819',
      'Benzoate- + H+ = H(Benzoate)',
      'log_k 4.202',
      'H+ + Glycine- = H(Glycine)',
      'log_k 9.778',
    ],
  },
  {
    id: 'NIST JPCRD buffer evaluation',
    url: 'https://www.nist.gov/system/files/documents/srd/jpcrd615.pdf',
    sha256: '8b10624546d35856b7e88c2c8e94e498c11d58df55c6815d8a3a82eecf9b9cf2',
  },
  {
    id: 'NIST JRES standard buffers 1962',
    url: 'https://nvlpubs.nist.gov/nistpubs/jres/066/2/V66.N02.A06.pdf',
    sha256: 'd3f25e6eaa5a99286bd93410096189d93363c6443ba4a39a3f2f34e4cd2bbee4',
  },
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha256LfText = (text) => sha256(Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8'))

for (const source of sources) {
  const response = await fetch(source.url)
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actualHash = sha256(bytes)
  if (actualHash !== source.sha256) {
    throw new Error(`${source.id}: SHA-256 mismatch (${actualHash})`)
  }
  if (source.markers) {
    const text = bytes.toString('utf8')
    for (const marker of source.markers) {
      if (!text.includes(marker)) throw new Error(`${source.id}: missing allowlist marker ${marker}`)
    }
  }
}

const identitySnapshot = await readFile(resolve('src/features/phPrediction/identityData.ts'), 'utf8')
const identityHash = sha256LfText(identitySnapshot)
const expectedIdentityHash = 'ddd81522a9df4b9904eb47c5ddca09e54e8f2df58862a7029389466edcdb534d'
if (identityHash !== expectedIdentityHash) {
  throw new Error(`PubChem identity snapshot SHA-256 mismatch (${identityHash})`)
}

const goldenArtifacts = [
  {
    id: 'PHREEQC golden input',
    path: 'src/features/phPrediction/fixtures/phreeqc-v3.8.8-golden.pqi',
    sha256: 'da8946eb6a0fccc7c35ad88a3bf5f3d7506cb10504ce25b5b675de1ada2a984f',
  },
  {
    id: 'PHREEQC selected output (LF-normalized)',
    path: 'src/features/phPrediction/fixtures/phreeqc-v3.8.8-golden.sel',
    sha256: '78b471c4249d36514583b48257cbe72484e880e655f91392524101ae81205cca',
  },
]

for (const artifact of goldenArtifacts) {
  const contents = await readFile(resolve(artifact.path), 'utf8')
  const actualHash = sha256LfText(contents)
  if (actualHash !== artifact.sha256) {
    throw new Error(`${artifact.id}: SHA-256 mismatch (${actualHash})`)
  }
}

console.log(
  `pH catalog sources verified (${sources.length} upstream artifacts + identity snapshot + ${goldenArtifacts.length} golden artifacts).`,
)
