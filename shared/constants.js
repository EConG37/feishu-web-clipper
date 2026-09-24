"use strict";

// 全局共享常量（background 通过 importScripts 加载；options 通过 <script> 加载）
const CONFIG_KEY = "feishu_clip_config";
const TAXONOMY_KEY = "clip_taxonomy";

// 模板多维表格（发布者所有）：使用者必须先「创建副本」，禁止把剪藏数据写进模板本身
const TEMPLATE_BASE_TOKENS = new Set([
  "SCEObFKEvaNjNhsJT3bcZuoKnSe", // 当前提示词模板
  "ZwXJb3TZVazIuvsqaVacB0Kani2", // 旧版单表模板
  "XKZJbYtmNaGXNWsOmRycXhUMnXf", // 旧版单表模板
  "EOD2b1O3wa1UpFsoOGzcfnALnjf"  // 新版九表提示词模板
]);

// 三级分类体系（可在设置页自定义）：
// 一级「提示词类型」→ 二级「分类」（决定写入哪张数据表）→ 风格（「子分类」字段）与模型（「使用模型」字段）
// 「主分类」字段写入「前缀-二级分类」，例如 prefix=生图 + 人物 → 生图-人物；前缀留空时只写二级名称
function migrateTaxonomy(stored) {
  if (!stored || !Object.keys(stored).length) return structuredClone(DEFAULT_TAXONOMY);
  const next = structuredClone(stored);
  const video = next['视频提示词'];
  if (video?.children && !video.children['成品提示词']) {
    video.children['成品提示词'] = structuredClone(DEFAULT_TAXONOMY['视频提示词'].children['成品提示词']);
  }
  return next;
}

const DEFAULT_TAXONOMY = {
  "生图提示词": {
    prefix: "生图",
    children: {
      "人物": {
        table: "生图提示词-人物",
        styles: ["古风", "仙侠", "玄幻", "现代", "动漫", "科幻", "西幻", "3D", "CG", "艺术"],
        models: ["GPT2", "bananaPro", "seedream5Pro", "seedream4.7", "seedream3.1", "MJ"]
      },
      "环境": {
        table: "生图提示词-环境",
        styles: ["古风", "仙侠", "现代", "科幻", "西幻", "3D", "CG", "艺术", "玄幻", "动漫", "巨构"],
        models: ["GPT2", "bananaPro", "seedream5Pro", "seedream4.7", "seedream3.1", "MJ"]
      },
      "生物": {
        table: "生图提示词-生物",
        styles: ["古风", "仙侠", "现代", "科幻", "西幻", "3D", "CG", "艺术", "玄幻", "动漫"],
        models: ["GPT2", "bananaPro", "seedream5Pro", "seedream4.7", "seedream3.1", "MJ"]
      },
      "海报": {
        table: "生图提示词-海报",
        styles: ["古风", "仙侠", "现代", "科幻", "西幻", "3D", "CG", "艺术"],
        models: ["GPT2", "bananaPro", "seedream5Pro", "seedream4.7", "seedream3.1", "MJ"]
      }
    }
  },
  "视频提示词": {
    prefix: "视频",
    children: {
      "镜头画面": {
        table: "视频提示词-镜头画面",
        styles: ["导演风格", "氛围质感", "摄影风格", "滤镜风格", "特效元素", "构图视角"],
        models: ["seedance2.0", "seedance2.5", "minimaxH3", "KelingO3"]
      },
      "运镜方案": {
        table: "视频提示词-运镜方案",
        styles: ["运镜方案", "转场手法"],
        models: ["seedance2.0", "seedance2.5", "minimaxH3", "KelingO3"]
      },
      "影视效应": {
        table: "视频提示词-影视效应",
        styles: ["天气环境", "物理效应", "光影效果", "生活log"],
        models: ["seedance2.0", "seedance2.5", "minimaxH3", "KelingO3"]
      },
      "成品提示词": {
        table: "视频提示词-成品提示词",
        styles: ["女频网红", "3D动画", "古风正剧", "现代正剧", "科幻质感"],
        models: ["seedance2.0", "seedance2.5", "minimaxH3", "KelingO3"]
      },
      "人物情绪": {
        table: "视频提示词-人物情绪",
        styles: ["表演情绪"],
        models: ["seedance2.0", "seedance2.5", "minimaxH3", "KelingO3"]
      }
    }
  }
};
