/* Native brand assets; development-only renderer: npm install --no-save sharp. */
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const component=path.join(root,'custom_components/pv_manager/brand');
  const source=fs.readFileSync(path.join(component,'pv.svg'),'utf8');
  for(const [prefix,svg] of [['',source],['dark_',source.replaceAll('#078bb5','#54c9ee').replaceAll('#e0f7ff','#113440')]]){
    for(const [suffix,size] of [['',256],['@2x',512]]){
      const png=await sharp(Buffer.from(svg)).resize(size,size).png({compressionLevel:9}).toBuffer();
      for(const directory of [component,path.join(root,'brand')]){
        fs.mkdirSync(directory,{recursive:true});
        fs.writeFileSync(path.join(directory,prefix+'icon'+suffix+'.png'),png);
      }
    }
  }
  console.log('PV brand icons: transparent PNG, 256/512px, light and dark.');
})().catch(error=>{console.error(error);process.exitCode=1;});
