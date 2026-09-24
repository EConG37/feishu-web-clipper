#!/usr/bin/env node
/**
 * 飞书多维表格「网页剪藏」模板一键创建脚本
 *
 * 用法：
 *   1. npm install （首次）或直接使用下方依赖
 *   2. 设置环境变量后运行：
 *        set APP_ID=cli_xxxxxxxx        （Windows CMD）
 *        set APP_SECRET=xxxxxxxx
 *        node create_bitable_template.js
 *
 * 脚本会：创建一个全新多维表格 → 建 6 个字段（文本×2、超链接、附件、分类多选、使用模型单选）→ 自动把 App ID 所代表的应用
 * 加为协作者（应用对自建表格默认有权限，通常无需额外操作）。
 */

const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error("请先设置环境变量 APP_ID 和 APP_SECRET（在飞书开放平台「凭证与基础信息」页获取）");
  process.exit(1);
}

const BASE = "https://open.feishu.cn";

async function api(path, options = {}) {
  const resp = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`${path} 失败(${data.code})：${data.msg}`);
  }
  return data.data;
}

let TOKEN = "";
async function getToken() {
  const resp = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`获取 token 失败(${data.code})：${data.msg}`);
  TOKEN = data.tenant_access_token;
}

async function main() {
  await getToken();

  // 1. 创建空多维表格（放根目录）
  const app = await api("/open-apis/bitable/v1/apps", {
    method: "POST",
    body: JSON.stringify({ name: "网页剪藏库" })
  });
  const appToken = app.app.app_token;
  const tableId = app.default_table_id; // 默认自带一张「数据表」
  console.log("✅ 多维表格已创建：", app.url);

  // 2. 把默认表改名为「剪藏」
  await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "剪藏" })
  });

  // 3. 建字段（超链接 / 附件 / 单选 / 多选 必须用 API 才能建出正确类型）
  const fields = [
    { field_name: "标题", type: 1 },          // 1 = 多行文本
    { field_name: "内容", type: 1 },          // 1 = 多行文本
    { field_name: "链接", type: 15 },         // 15 = 超链接
    { field_name: "封面", type: 17 },         // 17 = 附件
    {
      field_name: "分类", type: 4,            // 4 = 多选
      property: {
        multiple: true,
        options: [
          { name: "生图提示词" },
          { name: "视频提示词" }
        ]
      }
    },
    {
      field_name: "使用模型", type: 3,        // 3 = 单选
      property: {
        multiple: false,
        options: [
          { name: "GPT2" },
          { name: "bananaPro" },
          { name: "MJ" },
          { name: "seedream5Pro" },
          { name: "seedream4.7" },
          { name: "seedream3.1" },
          { name: "seedance2.0" },
          { name: "seedance2.5" },
          { name: "minimaxH3" },
          { name: "KelingO3" }
        ]
      }
    }
  ];
  for (const f of fields) {
    await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
      method: "POST",
      body: JSON.stringify(f)
    });
    console.log("  ✅ 字段已创建：", f.field_name);
  }

  // 4. 删除默认表自带的「文本」字段（可选，避免混淆）
  try {
    const existing = await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`);
    for (const f of existing.items || []) {
      if (f.field_name === "多行文本" || f.field_name === "文本") {
        await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${f.field_id}`, { method: "DELETE" });
        console.log("  🗑 已删除默认字段：", f.field_name);
      }
    }
  } catch (e) {
    console.warn("  ⚠ 清理默认字段失败（不影响使用）：", e.message);
  }

  console.log("\n🎉 全部完成！把下面这行复制到扩展设置页的「多维表格链接」：");
  console.log(`   ${app.url}`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
