const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ctx={structuredClone};vm.createContext(ctx);
for(const file of ['shared/constants.js','shared/classifier.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
vm.runInContext('globalThis.taxonomy=DEFAULT_TAXONOMY',ctx);
const run=(text,taxonomy=ctx.taxonomy)=>ctx.ClipClassifier.local(text,taxonomy);
test('clear image subjects, models and styles are selected from prompt only',()=>{
 const r=run('图片提示词：古风少女全身立绘，汉服，Midjourney --ar 9:16');
 assert.equal(r.group,'生图提示词');assert.equal(r.subcategory,'人物');assert.equal(r.style,'古风');assert.equal(r.model,'MJ');
 assert.equal(run('A landscape painting, mountains and lakes, seedream 4.7').subcategory,'环境');
 assert.equal(run('海报设计，字体排版与品牌标志').subcategory,'海报');
 assert.equal(run('生物设计，一只神兽，仙侠风格').subcategory,'生物');
});
test('complete video and dedicated camera examples are distinct',()=>{
 const r=run('生成一段3D动画视频。场景一：机器人起身。场景二：向前奔跑。Seedance 2.5');
 assert.equal(r.group,'视频提示词');assert.equal(r.subcategory,'成品提示词');assert.equal(r.style,'3D动画');assert.equal(r.model,'seedance2.5');
 assert.equal(run('运镜方案：镜头缓慢推进，camera movement').subcategory,'运镜方案');
 assert.equal(run('视频中的人物情绪：愤怒转向悲伤').subcategory,'人物情绪');
});
test('product commercial has no forced drama style; unsupported model remains empty',()=>{
 const r=run('生成一个护肤品商业广告视频。场景一：精华液特写。场景二：水滴落下。');
 assert.equal(r.subcategory,'成品提示词');assert.equal(r.style,'');
 assert.equal(run('GPT 6 Astra+Blender制作了下面这个演示视频，3D场景建模').model,'');
});
test('empty, conflicting or vague prompts do not guess a destination',()=>{
 assert.equal(run('').subcategory,'');assert.equal(run('好漂亮，收藏一下').subcategory,'');
 assert.equal(run('图片提示词：少女肖像与环境概念风景画').subcategory,'');
 assert.equal(run('生成一个视频，同时生成海报与插画').subcategory,'');
 assert.equal(run('用于视频的分镜海报。场景一：人物。场景二：环境。').subcategory,'');
});
test('negative prompt does not determine subject, style or model',()=>{
 const r=run('图片提示词：古风人物立绘。负面提示词：科幻，CG，MJ，风景画');
 assert.equal(r.subcategory,'人物');assert.equal(r.style,'古风');assert.equal(r.model,'');
});
test('only existing taxonomy labels; custom explicit labels and regex characters are safe',()=>{
 const t={'自定义(组)':{children:{'道具+设定':{table:'my table',styles:['金属'],models:[]}}}};
 assert.equal(run('分类：自定义(组)-道具+设定\n金属',t).subcategory,'道具+设定');
 assert.equal(run('图片提示词：人物肖像',t).subcategory,'');
 assert.equal(run('分类：人物\n分类：海报').subcategory,'');
});
test('model versions are explicit, multiple models are left blank',()=>{
 assert.equal(run('生成视频，Seedance 2.5').model,'seedance2.5');
 assert.equal(run('生成视频，Seedance 2.50').model,'');
 assert.equal(run('生成视频，Seedance 2.0 和 Seedance 2.5').model,'');
});
