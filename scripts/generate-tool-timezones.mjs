import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const tz=require('@touch4it/ical-timezones');
const names=require('@touch4it/ical-timezones/zones.js');
const components={UTC:'BEGIN:VTIMEZONE\r\nTZID:UTC\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0000\r\nEND:STANDARD\r\nEND:VTIMEZONE'};
for(const name of Object.keys(names)){
 try{new Intl.DateTimeFormat('en',{timeZone:name});}catch{continue;}
 const text=tz.getVtimezoneComponent(name);
 if(text)components[name]=text.trim().replace(/^TZID:[^\r\n]+/m,`TZID:${name}`);
}
await writeFile(new URL('../src/features/tools/data/timezones.json',import.meta.url),JSON.stringify(components));
process.stdout.write(`Generated ${Object.keys(components).length} timezone components (@touch4it/ical-timezones 1.9.0, ISC).\n`);
