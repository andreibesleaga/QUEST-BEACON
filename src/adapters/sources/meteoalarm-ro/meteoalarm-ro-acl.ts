// BEACON — MeteoAlarm Romania anti-corruption layer (E4·T-177, Part-B; adapter-contract §4, Art. XII).
// B3.1 WIDENING, backward-compatible ALIAS: the parser/mapper now live in the generic
// `../meteoalarm/meteoalarm-acl.ts` (one MeteoAlarm producer emits every country feed — see that header
// for the verified shape + the honest NewsItem mapping choice). This module re-exports them under their
// original names so the RO adapter, its recorded fixture (`__fixtures__/romania-atom.xml`) and its tests
// keep working unchanged. Behaviour is byte-identical (pinned by the untouched meteoalarm-ro-acl.test.ts).
export type { MeteoalarmLink, MeteoalarmEntry } from '../meteoalarm/meteoalarm-acl.js';
export {
  parseMeteoalarm as parseMeteoalarmRo,
  meteoalarmMapper as meteoalarmRoMapper,
} from '../meteoalarm/meteoalarm-acl.js';
