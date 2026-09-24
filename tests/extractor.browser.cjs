async (page) => {
  const target = '2093965694786568484';
  const targetUrl = `https://x.com/sergeantsref/status/${target}`;
  const reports = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const extractor = await (await page.request.get('http://127.0.0.1:8899/content/extractor.js')).text();
  const turndown = await (await page.request.get('http://127.0.0.1:8899/lib/turndown.js')).text();
  const readability = await (await page.request.get('http://127.0.0.1:8899/lib/Readability.js')).text();
  let fixture = '';
  await page.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fixture + '</body></html>' }));
  await page.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fixture + '</body></html>' }));
  await page.route('https://mobile.twitter.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>' + fixture + '</body></html>' }));
  await page.addInitScript(() => {
    window.__listeners = [];
    window.chrome = { runtime: { onMessage: { addListener: (listener) => window.__listeners.push(listener) } } };
  });
  const post = (id, text, extra = '') => `<article data-testid="tweet"><div data-testid="User-Name"><a role="link" href="/someone/status/${id}"><time>Sep 6</time></a></div>${text === null ? '' : `<div data-testid="tweetText">${text}</div>`}${extra}<div role="group">88 replies 100 likes</div></article>`;
  const load = async (html, url = targetUrl, realReadability = true) => {
    fixture = html;
    await page.goto(url);
    await page.addScriptTag({ content: turndown });
    if (realReadability) await page.addScriptTag({ content: readability });
    await page.addScriptTag({ content: extractor });
  };
  const extract = (pageUrl) => page.evaluate((url) => new Promise((resolve) => {
    window.__listeners[0]({ type: 'CLIP Extract Content', pageUrl: url || location.href }, {}, resolve);
  }), pageUrl);
  const equal = (actual, expected, name) => {
    if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    reports.push(name);
  };
  const recommendations = post('2096007734642552835', 'Gumroad is hiring creators-in-residence. $60,000. '.repeat(12)) + post('2096046840546549761', 'Asked Astra to make a delicious and bouncy jelly. '.repeat(12));
  const noise = '<aside data-testid="sidebarColumn"><h2>当前趋势</h2>CFB Pick Em. Promoted by FanDuel Sports.</aside>';
  await load('<main data-testid="primaryColumn"><h1>帖子</h1>' + recommendations + post(target, '--sref 200353321') + '</main>' + noise);
  let result = await extract();
  equal(result.markdown, '--sref 200353321', 'exact reported short post despite long recommendations');
  equal(result.text, result.markdown, 'text and markdown refer to same post');
  equal(result.postId, target, 'matched URL post ID');
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.evaluate((value) => {
    const panel = document.createElement('pre'); panel.id = 'extraction-result'; panel.textContent = '提取结果\n' + value;
    panel.style.cssText = 'position:fixed;right:30px;top:30px;padding:24px;background:#eaf5ef;border:1px solid #176b52;font-size:22px;color:#176b52'; document.body.appendChild(panel);
  }, result.markdown);
  await page.screenshot({ path: 'output/playwright/x-extraction-result.png' });
  await load('<main>' + post('111', 'Other post', `<div role="link"><a href="/sergeantsref/status/${target}"><time>Quoted time</time></a><div data-testid="tweetText">WRONG QUOTED TEXT</div></div>`) + post(target, '--sref 200353321', '<div role="link"><a href="/someone/status/222"><time>Time</time></a><div data-testid="tweetText">Do not include quoted text</div></div>') + '</main>');
  equal((await extract()).markdown, '--sref 200353321', 'ignore matching timestamp inside quoted card and exclude quotes');
  await load('<main>' + post('333', `<a href="/sergeantsref/status/${target}">Original post link</a>`) + post(target, '--sref 200353321') + '</main>');
  equal((await extract()).markdown, '--sref 200353321', 'body link to target does not select wrong tweet');
  await load('<main>' + post(target, '--sref 200353321', post('444', 'Nested quoted article')) + '</main>');
  equal((await extract()).markdown, '--sref 200353321', 'ignore nested quote article');
  await load('<main>' + post(target, '<span>--sref 200353321</span><br><span>--ar 16:9</span><br><img alt="🎨"> <a href="https://example.com">example.com</a>') + '</main>');
  equal((await extract()).markdown, '--sref 200353321\n--ar 16:9\n🎨 example.com', 'preserve parameters, newline, emoji and visible link text');
  await load('<main>' + post(target, '--sref 200353321') + '</main>', targetUrl + '/photo/1');
  equal((await extract()).markdown, '--sref 200353321', 'photo detail URL matches original post');
  await load('<main>' + post(target, 'x') + '</main>');
  equal((await extract()).markdown, 'x', 'single-character post is valid');
  await load('<main>' + post(target, '--sref 200353321') + '</main>', 'https://mobile.twitter.com/sergeantsref/status/' + target);
  equal((await extract()).markdown, '--sref 200353321', 'legacy Twitter host');
  await load('<main>' + recommendations + '</main>');
  await page.evaluate((html) => setTimeout(() => document.querySelector('main').insertAdjacentHTML('afterbegin', html), 350), post(target, '--sref 200353321'));
  equal((await extract()).markdown, '--sref 200353321', 'wait for dynamically loaded target post');
  await load('<main>' + post(target, 'Visible start', '<button data-testid="tweet-text-show-more-link">Show more</button>') + '</main>');
  result = await extract();
  equal(result.warning.includes('显示更多'), true, 'warn about collapsed long text');
  await load('<main>' + recommendations + '</main>');
  result = await extract();
  equal(result.markdown, '', 'missing target never falls back to recommendations');
  equal(result.warning.includes('原帖'), true, 'missing target has actionable warning');
  await load('<main>' + post(target, null, '<div role="link"><div data-testid="tweetText">Only quote has text</div></div>') + '</main>');
  result = await extract();
  equal(result.markdown, '', 'image-only or quote-only target does not borrow other text');
  await load('<main>' + recommendations + '</main>');
  await page.evaluate(() => setTimeout(() => history.pushState({}, '', '/other/status/555'), 250));
  result = await extract(targetUrl);
  equal(result.markdown, '', 'navigation during loading does not mix post and saved URL');
  equal(result.error.includes('切换'), true, 'navigation displays restart warning');
  await load('<article><p>Short correct body</p></article><main>' + '<p>Wrong much longer content</p>'.repeat(30) + '</main>', 'https://example.com/article', false);
  await page.evaluate(() => { window.Readability = class { parse() { return { content: '<p>Short correct body</p>', textContent: 'Short correct body' }; } }; });
  equal((await extract()).markdown, 'Short correct body', 'generic short article is not replaced by larger container');
  await load('<div class="post-content">Tiny body</div><main>' + '<p>Other content</p>'.repeat(30) + '</main>', 'https://example.com/article', false);
  equal((await extract()).markdown, 'Tiny body', 'semantic short content fallback');
  await load('<nav>Navigation only</nav><aside>Trending ads</aside><div>No known article here</div>', 'https://example.com/article', false);
  result = await extract();
  equal(result.markdown || result.text, '', 'no whole-body fallback when content is not identified');
  await load('<article><h1>Long article</h1><p>' + 'This is the actual article text, containing meaningful detailed information. '.repeat(15) + '</p></article><aside>Trending advertisement</aside>', 'https://example.com/article');
  result = await extract();
  equal(result.markdown.includes('actual article text'), true, 'real Readability still extracts normal articles');
  equal(result.markdown.includes('Trending advertisement'), false, 'normal article excludes sidebar');
  // AI 作品详情页：提示词在旁栏「标签 + 相邻值」结构中，正文容器覆盖不到
  const jimengFixture = '<div class="detail-main"><div class="detail-area"><div class="detail-info">' +
    '<div class="prompt-tip">图片提示词</div>' +
    '<div class="prompt-value"><span>帮我生成图片：国风墨染动漫风的水粉画，营造唯美空灵的氛围，画面有厚重质感和密集颗粒感。</span></div>' +
    '<div class="prompt-tags"><div>图片 4.7</div><div>9:16</div></div>' +
    '</div></div></div>';
  await load(jimengFixture, 'https://example.com/ai-work-detail', false);
  result = await extract();
  equal(result.markdown.includes('帮我生成图片'), true, 'sidebar prompt block is captured on AI work page');
  // 详情页残留只有作者名等零星文字时，摘录收敛为提示词 + 生成参数；按钮与作者名去掉
  await load(jimengFixture + '<div class="user-profile"><div class="user-name">某位创作者</div><div class="user-actions">做同款 用作参考图</div></div>', 'https://example.com/ai-work-detail2', false);
  result = await extract();
  equal(result.markdown, '图片提示词：\n帮我生成图片：国风墨染动漫风的水粉画，营造唯美空灵的氛围，画面有厚重质感和密集颗粒感。\n\n图片 4.7 9:16', 'work detail page keeps prompt and model params');
  equal(result.markdown.includes('某位创作者'), false, 'author name is dropped');
  equal(result.markdown.includes('做同款'), false, 'action buttons are dropped');
  // 详情在全屏弹窗中（从信息流点开）时，弹窗背后的页面内容不混入摘录
  const modalFixture = '<main>' + '<p>信息流推荐内容，与作品详情无关。'.repeat(40) + '</p></main>' +
    '<div class="lv-modal-wrapper" role="dialog" aria-modal="true" style="position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:1001">' +
    '<div class="detail-area"><div class="detail-info">' +
    '<div class="prompt-tip">图片提示词</div>' +
    '<div class="prompt-value"><span>帮我生成图片：国风墨染动漫风的水粉画，营造唯美空灵的氛围，画面有厚重质感和密集颗粒感。</span></div>' +
    '<div class="prompt-tags"><div>图片 4.7</div><div>9:16</div></div>' +
    '</div><div class="user-actions">做同款 关注</div></div></div>';
  await load(modalFixture, 'https://example.com/ai-work-modal', false);
  result = await extract();
  equal(result.markdown.includes('帮我生成图片'), true, 'modal detail keeps the prompt');
  equal(result.markdown.includes('信息流推荐内容'), false, 'modal detail excludes feed behind overlay');
  equal(result.markdown.includes('做同款'), false, 'modal detail drops action buttons');
  // 正文已含提示词时不重复追加
  await load('<article><h1>作品</h1><p>图片提示词：帮我生成图片：国风墨染动漫风的水粉画，营造唯美空灵的氛围。</p></article>', 'https://example.com/work', false);
  result = await extract();
  equal(result.markdown.split('帮我生成图片').length - 1, 1, 'prompt already in body is not appended twice');
  // 无提示词的普通页面行为不变
  await load('<article><p>Plain article without any prompt label inside.</p></article>', 'https://example.com/plain', false);
  result = await extract();
  equal(result.markdown, 'Plain article without any prompt label inside.', 'plain article output unchanged');
  // 提示词只占小部分的长文章保留全文并补齐提示词，不会误删正文
  const longBody = '这是一篇讨论提示词写法的长文章，包含大量正文内容。'.repeat(20);
  await load('<article><h1>教程</h1><p>' + longBody + '</p></article>' +
    '<div class="prompt-tip">图片提示词</div><div class="prompt-value"><span>帮我生成图片：赛博朋克城市夜景，霓虹灯与雨天倒影交相辉映。</span></div>', 'https://example.com/tutorial', false);
  result = await extract();
  equal(result.markdown.includes('讨论提示词写法'), true, 'long article keeps full body');
  equal(result.markdown.includes('赛博朋克'), true, 'long article also gains the missing prompt');
  await page.addScriptTag({ content: extractor });
  equal(await page.evaluate(() => window.__listeners.length), 1, 'reinjection does not add listeners');
  equal(errors.length, 0, 'no browser script errors');
  return { passed: reports.length, checks: reports };
}
