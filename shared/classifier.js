"use strict";

// Classification input is the prompt text only. No title, URL, image, or video is used.
globalThis.ClipClassifier = (() => {
  const empty = reason => ({group:'',subcategory:'',style:'',model:'',confidence:'low',reason,source:'local'});
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function explicitModels(text, models) {
    const aliases = {
      GPT2: /\b(?:gpt[ -]?(?:image[ -]?)?2(?:\.0)?)\b/i,
      MJ: /\b(?:midjourney|mj)\b|--sref\b|--stylize\b/i,
      "seedance2.0": /seedance\s*2(?:\.0)?(?![\d.])/i,
      "seedance2.5": /seedance\s*2\.5(?![\d.])/i,
      bananaPro: /\b(?:nano\s*)?banana\s*pro\b/i,
      seedream5Pro: /seedream\s*5(?:\.0)?\s*pro\b/i,
      "seedream4.7": /seedream\s*4\.7(?![\d.])/i,
      "seedream3.1": /seedream\s*3\.1(?![\d.])/i,
      minimaxH3: /minimax\s*h3\b/i,
      KelingO3: /(?:kling|keling|可灵)\s*o3\b/i
    };
    return models.filter(m => aliases[m] ? aliases[m].test(text) : new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`,'i').test(text));
  }
  function pickStyle(text, styles) {
    const rules = {
      '3D动画': /3d\s*(?:动画|anime|animation)|(?:cel.shaded|cgi|三维)\s*(?:动画|anime|animation)/i,
      '古风正剧': /古风正剧|古装正剧|历史正剧/,
      '现代正剧': /现代正剧|现代都市剧|都市正剧/,
      '女频网红': /女频网红|网红博主|美妆博主|fashion\s*influencer/i,
      '科幻质感': /科幻|science.fiction|sci.fi|赛博朋克|cyberpunk/i,
      '古风': /古风|古装|汉服/,
      '仙侠': /仙侠|修仙/,
      '现代': /现代都市|现代风格/,
      '科幻': /科幻|science.fiction|sci.fi|赛博朋克|cyberpunk/i,
      '3D': /\b3d\b|三维渲染/i,
      '动漫': /动漫|\banime\b/i,
      'CG': /\bcg\b|\bcgi\b/i
    };
    const matches = styles.filter(s => rules[s] ? rules[s].test(text) : s.length >= 2 && text.includes(s));
    return matches.length === 1 ? matches[0] : '';
  }
  function local(text, taxonomy) {
    if (!text.trim()) return empty('填写提示词后推荐分类');
    // Negative prompts are exclusions, not evidence for the intended subject/style.
    text = text.replace(/(?:负面提示词|负向提示词|negative prompt)\s*[:：][\s\S]*$/i,'');
    let group='', subcategory='';
    // Explicit user-authored classification labels take precedence over broad signals.
    const named=[];
    for (const [g,def] of Object.entries(taxonomy)) for (const n of Object.keys(def.children || {}))
      if (new RegExp(`(?:分类|归档)\\s*[:：]\\s*(?:${escape(g)}\\s*[/>→-]\\s*)?${escape(n)}(?:\\s|$|[，,；;])`).test(text)) named.push([g,n]);
    if (named.length > 1) return empty('提示词包含多个分类，请选择主要用途');
    if (named.length === 1) [group,subcategory]=named[0];
    if (!subcategory) {
      const timeline = /(?:\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}|(?:镜头|场景|shot|scene)\s*[一二三四五六七八九十\d]+\s*[:：])/i;
      const video = /视频|短片|\bvideo\b|\bshort film\b|seedance|运镜|转场|镜头运动|camera movement|物理效应|表演情绪|人物情绪/i.test(text) || timeline.test(text);
      const image = /图片提示词|生图提示词|\bimage prompt\b|\bmidjourney\b|--sref\b|--ar\b|seedream|立绘|肖像|人像|海报|插画|风景画|山水画|环境概念|场景概念|生物设计|怪兽|神兽|\bportrait\b|\blandscape\b|\bposter\b|\bcharacter sheet\b|\bcreature\b/i.test(text);
      if (video && !image) {
        group='视频提示词';
        if (timeline.test(text) || /(?:制作|生成|创作|create|generate).{0,35}(?:视频|短片|video|short film)|成品提示词|完整视频/i.test(text)) subcategory='成品提示词';
        else {
          const kinds = [
            ['运镜方案',/运镜方案|转场手法|camera movement|camera transition/i],
            ['影视效应',/物理效应|天气环境|光影效果/],
            ['人物情绪',/表演情绪|人物情绪|情绪表演/],
            ['镜头画面',/导演风格|摄影风格|滤镜风格|构图视角/]
          ].filter(([,rx])=>rx.test(text));
          if (kinds.length === 1) subcategory=kinds[0][0];
        }
      } else if (image && !video) {
        group='生图提示词';
        const kinds = [
          ['海报',/海报|\bposter\b|宣传画/i],
          ['人物',/人物立绘|角色立绘|人物肖像|人像|\bportrait\b|\bcharacter sheet\b|少女|少年|美男/i],
          ['环境',/环境概念|场景概念|风景画|山水画|\blandscape\b|\benvironment concept\b/i],
          ['生物',/生物设计|怪兽|神兽|\bcreature\b|\bmonster\b/i]
        ].filter(([,rx])=>rx.test(text));
        if (kinds.length === 1) subcategory=kinds[0][0];
      }
    }
    const child=taxonomy[group]?.children?.[subcategory];
    if (!child) return {...empty('仅凭提示词暂不能确定分类，可手动选择'),group:taxonomy[group] ? group : ''};
    const models=explicitModels(text,child.models || []);
    return {group,subcategory,style:pickStyle(text,child.styles || []),model:models.length === 1 ? models[0] : '',confidence:'high',source:'local',reason:'根据提示词中的明确描述推荐；不确定项留空'};
  }
  return {local,explicitModels};
})();
