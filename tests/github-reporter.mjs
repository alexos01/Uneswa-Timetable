// node --test reporter for GitHub Actions: each failing test becomes an error
// annotation on the run summary, so the cause shows without opening the log.
// Used next to the normal spec reporter in .github/workflows/mobile.yml.
const clean = s=>String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');

export default async function* githubReporter(source){
  for await (const event of source){
    if(event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const { name, file, line, details } = event.data;
    const err = details?.error?.cause || details?.error;
    const where = file ? `file=${clean(file.replace(process.cwd() + '/', ''))}${line ? `,line=${line}` : ''},` : '';
    yield `::error ${where}title=${clean(name)}::${clean((err?.message || err || 'failed').toString().slice(0, 1500))}\n`;
  }
}
