/**
 * 通用题库智能解析器 (Smart Question Bank Parser)
 * 能够高容错解析纯文本、Markdown、Word复制内容、CSV及JSON
 */
(function (global) {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var TRUE_TERMS = ['正确', '对', '是', 'T', 'TRUE', '√', 'V', 'A', '1'];
  var FALSE_TERMS = ['错误', '错', '否', 'F', 'FALSE', '×', 'X', 'B', '0'];

  // 选项行前缀正则：匹配 A. A、 A: A： (A) [A]
  var OPT_LINE_RE = /^[\s_]*[（(\[]?\s*([A-Ha-h])\s*[)\]]?[.、:：\s]\s*(.*)$/;
  // 单行内挤压多选项拆分正则：预查 A. B. C. D.
  var INLINE_OPT_RE = /(?=[A-Ha-h]\s*[:：.、])/;
  // 答案行匹配正则
  var ANS_LINE_RE = /^[\s_]*[【\[]?\s*(?:答案|参考答案|正确答案|标准答案|Answer|Key)\s*[】\]]?\s*[:：=\s]\s*(.*)$/i;
  // 解析行匹配正则
  var EXP_LINE_RE = /^[\s_]*[【\[]?\s*(?:解析|试题解析|考点解析|分析|说明|Explanation)\s*[】\]]?\s*[:：=\s]\s*(.*)$/i;
  // 分类行匹配正则
  var CAT_LINE_RE = /^[\s_]*[【\[]?\s*(?:分类|章节|模块|科目|Category)\s*[】\]]?\s*[:：=\s]\s*(.*)$/i;
  // 题干中括号内自带答案正则：（A） (B)
  var EMBEDDED_ANS_RE = /[（(]\s*([A-Ha-h对错正确错误是是否TFtf√×])\s*[)）]/;

  /**
   * 规范化题干括号
   * 1. 如果题干包含全角/半角圆括号，统一样式
   * 2. 如果包含自带答案，例如 (A) -> 替换为标准填空位 （ ），并提取答案
   * 3. 如果是单选题且完全没有括号，自动在末尾追加全角括号 （ ）
   */
  function normalizeStem(stem, isJudge, extractedAns) {
    if (!stem) return { stem: '', extractedAnswer: extractedAns };
    var ans = extractedAns;

    // 检查是否有嵌入的答案
    var m = stem.match(EMBEDDED_ANS_RE);
    if (m) {
      if (!ans) ans = m[1].toUpperCase();
      // 将原位置替换为标准全角空括号
      stem = stem.replace(EMBEDDED_ANS_RE, '（ ）');
    }

    // 统一半角空括号为全角空括号
    stem = stem.replace(/\(\s*\)/g, '（ ）');
    stem = stem.replace(/（\s*）/g, '（ ）');

    // 单选题若无括号且非判断题，则自动在末尾或句尾标点前补齐括号
    if (!isJudge && stem.indexOf('（ ）') === -1) {
      var trimmed = stem.trim();
      var lastChar = trimmed.slice(-1);
      if (lastChar === '。' || lastChar === '？' || lastChar === '?' || lastChar === '：' || lastChar === ':') {
        stem = trimmed.slice(0, -1) + '（ ）' + lastChar;
      } else {
        stem = trimmed + '（ ）';
      }
    }

    return { stem: stem.trim(), extractedAnswer: ans };
  }

  /**
   * 判断一段文本是否属于 CSV 格式
   */
  function isCsvFormat(text) {
    var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return false;
    var first = lines[0];
    return (first.indexOf(',') !== -1 || first.indexOf('\t') !== -1) &&
           (first.indexOf('题干') !== -1 || first.indexOf('stem') !== -1 || first.indexOf('选项') !== -1);
  }

  /**
   * 解析 CSV / TSV 格式
   */
  function parseCsv(text, defaultCat) {
    var delimiter = text.indexOf('\t') !== -1 ? '\t' : ',';
    var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length <= 1) return [];

    var headers = lines[0].split(delimiter).map(function (h) { return h.trim().replace(/^["']|["']$/g, ''); });
    var typeCol = headers.findIndex(function (h) { return /类型|type|题型/i.test(h); });
    var stemCol = headers.findIndex(function (h) { return /题干|stem|题目|题/i.test(h); });
    var ansCol = headers.findIndex(function (h) { return /答案|answer|key/i.test(h); });
    var catCol = headers.findIndex(function (h) { return /分类|cat|category|章节/i.test(h); });
    var expCol = headers.findIndex(function (h) { return /解析|explain|analysis/i.test(h); });

    // 选项列查找
    var optCols = [];
    headers.forEach(function (h, idx) {
      if (/选项\s*[A-D]|opt|choice/i.test(h)) {
        optCols.push(idx);
      }
    });

    var results = [];
    var qid = 1;

    for (var i = 1; i < lines.length; i++) {
      var row = lines[i].split(delimiter).map(function (c) { return c.trim().replace(/^["']|["']$/g, ''); });
      if (row.length === 0 || !row[stemCol >= 0 ? stemCol : 0]) continue;

      var stem = stemCol >= 0 ? row[stemCol] : row[1] || row[0];
      var rawType = typeCol >= 0 ? row[typeCol] : '';
      var rawAns = ansCol >= 0 ? row[ansCol] : '';
      var cat = (catCol >= 0 && row[catCol]) ? row[catCol] : defaultCat || '通用';
      var explain = (expCol >= 0 && row[expCol]) ? row[expCol] : '';

      var isJudge = /判断|judge|tf/i.test(rawType) || /^[对错正确错误是是否TFtf√×]$/.test(rawAns.trim());
      var opts = [];

      if (!isJudge && optCols.length > 0) {
        optCols.forEach(function (colIdx) {
          if (row[colIdx]) opts.push(row[colIdx]);
        });
      }

      var ansIdx = 0;
      if (isJudge) {
        opts = ['正确', '错误'];
        var trimmedAns = rawAns.trim().toUpperCase();
        if (FALSE_TERMS.indexOf(trimmedAns) !== -1) {
          ansIdx = 1;
        } else {
          ansIdx = 0;
        }
      } else {
        var letter = rawAns.trim().toUpperCase();
        var lIdx = LETTERS.indexOf(letter);
        ansIdx = lIdx >= 0 ? lIdx : 0;
      }

      var norm = normalizeStem(stem, isJudge, null);

      results.push({
        id: qid++,
        type: isJudge ? 'judge' : 'single',
        stem: norm.stem,
        opts: opts.length > 0 ? opts : ['选项A', '选项B', '选项C', '选项D'],
        answer: ansIdx,
        cat: cat,
        explain: explain
      });
    }

    return results;
  }

  /**
   * 将多行单题块解析为单道试题对象
   */
  function parseSingleQuestionBlock(blockLines, qid, currentCat) {
    if (!blockLines || blockLines.length === 0) return null;

    var stemRaw = '';
    var opts = [];
    var rawAnswer = '';
    var explain = '';
    var questionCat = currentCat || '综合';
    var inStem = true;

    for (var i = 0; i < blockLines.length; i++) {
      var line = blockLines[i].trim();
      if (!line) continue;

      // 1. 检查是否为分类行
      var catMatch = line.match(CAT_LINE_RE);
      if (catMatch) {
        questionCat = catMatch[1].trim();
        inStem = false;
        continue;
      }

      // 2. 检查是否为答案行
      var ansMatch = line.match(ANS_LINE_RE);
      if (ansMatch) {
        rawAnswer = ansMatch[1].trim();
        inStem = false;
        continue;
      }

      // 3. 检查是否为解析行
      var expMatch = line.match(EXP_LINE_RE);
      if (expMatch) {
        explain = expMatch[1].trim();
        inStem = false;
        continue;
      }

      // 4. 检查是否包含选项 (如 A. xxx 或一行内多个 A. xx B. xx)
      var optMatch = line.match(OPT_LINE_RE);
      if (optMatch) {
        inStem = false;
        // 检查该行是否被塞了多个选项 (A. xx B. xx)
        var parts = line.split(INLINE_OPT_RE).map(function (s) { return s.trim(); }).filter(Boolean);
        if (parts.length > 1) {
          parts.forEach(function (part) {
            var pm = part.match(OPT_LINE_RE);
            if (pm) opts.push(pm[2].trim());
            else opts.push(part);
          });
        } else {
          opts.push(optMatch[2].trim());
        }
        continue;
      }

      // 5. 仍在题干中，累加题干文本
      if (inStem) {
        // 清理题号前缀（如 "1. " "2、" "（1）"）
        if (!stemRaw) {
          var cleanStem = line.replace(/^[\s_]*[（(\[]?\s*\d+\s*[)\]]?[.、:：\s]\s*/, '');
          // 若清理后依然有 "题干：" 前缀
          cleanStem = cleanStem.replace(/^[\s_]*题干\s*[:：]\s*/, '');
          stemRaw = cleanStem;
        } else {
          stemRaw += ' ' + line;
        }
      } else {
        // 如果已经离开了题干且非答案/解析/选项，可能是解析追加行
        if (explain) {
          explain += ' ' + line;
        }
      }
    }

    if (!stemRaw) return null;

    // 过滤无意义的纯噪音/乱码块：
    // 若没有选项、没有答案，且既没有明确题号也没有括号/问号/判断关键词，或者以大段乱码符号开头
    var firstLine = (blockLines[0] || '').trim();
    var hasNum = /^\s*(?:第\s*)?\d+[\.、:：)\]\s]/.test(firstLine);
    var hasBracket = /[（(][\s_]*[)）]|？|\?/.test(stemRaw);
    var isNoisePattern = /^[~=\-*%#@!]{2,}|乱码|噪点|残损/.test(stemRaw);
    if (isNoisePattern || (opts.length === 0 && !rawAnswer && !hasNum)) {
      return null;
    }

    // 答案判断：
    var upperAns = rawAnswer ? rawAnswer.trim().toUpperCase() : '';
    var isJudge = false;

    // 判断题判定逻辑：
    // a. 显式答案为明确对错词（对/错/正确/错误/T/F/√/×）且无选项或选项为对错
    // b. 或者选项只有 2 个且选项内容为对/错
    // c. 或者完全无选项
    var pureJudgeTerms = ['正确', '对', '是', 'T', 'TRUE', '√', 'V', '错误', '错', '否', 'F', 'FALSE', '×', 'X'];
    var hasJudgeOpts = opts.length === 2 && opts.some(function (o) { return /^[正确错误对错TFtf√×]$/.test(o.trim()); });
    if (pureJudgeTerms.indexOf(upperAns) !== -1) {
      if (opts.length === 0 || hasJudgeOpts) {
        isJudge = true;
      }
    } else if (opts.length === 0) {
      // 无选项，按判断题尝试
      isJudge = true;
    }

    var norm = normalizeStem(stemRaw, isJudge, upperAns);
    stemRaw = norm.stem;
    if (!upperAns && norm.extractedAnswer) {
      upperAns = norm.extractedAnswer;
    }

    var qWarnings = [];
    if (!upperAns) {
      qWarnings.push('缺失标准答案，已兜底设为 A（建议在下方核对）');
    }

    var finalType = isJudge ? 'judge' : 'single';
    var finalOpts = [];
    var answerIndex = 0;

    if (isJudge) {
      finalOpts = ['正确', '错误'];
      if (FALSE_TERMS.indexOf(upperAns) !== -1) {
        answerIndex = 1;
      } else {
        answerIndex = 0;
      }
    } else {
      // 单选题
      if (opts.length === 0) {
        finalOpts = ['选项A', '选项B', '选项C', '选项D'];
        qWarnings.push('单选题未检测到选项，已自动填充选项 A-D 占位');
      } else if (opts.length < 3) {
        finalOpts = opts.slice();
        while (finalOpts.length < 4) {
          finalOpts.push('备选选项 ' + LETTERS[finalOpts.length]);
        }
        qWarnings.push('选项数量残缺（原仅 ' + opts.length + ' 项），已自动补齐为 4 选项');
      } else {
        finalOpts = opts;
      }

      var lIdx = LETTERS.indexOf(upperAns);
      if (lIdx >= 0 && lIdx < finalOpts.length) {
        answerIndex = lIdx;
      } else {
        var num = parseInt(upperAns, 10);
        if (!isNaN(num) && num >= 1 && num <= finalOpts.length) {
          answerIndex = num - 1;
        } else {
          answerIndex = 0;
        }
      }
    }

    return {
      id: qid,
      type: finalType,
      stem: stemRaw,
      opts: finalOpts,
      answer: answerIndex,
      cat: questionCat,
      explain: explain || '',
      warnings: qWarnings
    };
  }

  /**
   * 纯文本智能切题与解析入口
   */
  function parseText(rawText, defaultBankName) {
    if (!rawText || !rawText.trim()) {
      return {
        meta: { name: defaultBankName || '自定义题库', total: 0, single: 0, judge: 0, cats: [] },
        questions: [],
        warnings: []
      };
    }

    var text = rawText.trim();

    // 1. 如果输入是 JSON 字符串，尝试直接按 JSON 解析
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        var parsedJson = JSON.parse(text);
        if (Array.isArray(parsedJson)) {
          return normalizeFromQuestionsArray(parsedJson, defaultBankName);
        } else if (parsedJson.questions && Array.isArray(parsedJson.questions)) {
          return normalizeFromFullBank(parsedJson, defaultBankName);
        }
      } catch (e) {
        // 不是有效JSON，继续走纯文本解析
      }
    }

    // 2. 如果输入是 CSV / TSV 格式
    if (isCsvFormat(text)) {
      var csvQuestions = parseCsv(text, '通用');
      return normalizeFromQuestionsArray(csvQuestions, defaultBankName);
    }

    // 3. 纯文本逐行切块解析
    var lines = text.split(/\r?\n/);
    var questions = [];
    var warnings = [];
    var curBlock = [];
    var currentCat = '综合';
    var bankName = '';

    // 题号起始匹配：匹配形如 "1. " "一、" "第1题" "【1】" "(1)"
    var Q_START_RE = /^[\s_]*(?:(?:第\s*)?\d+\s*[.、:：)\]]|[(（]\s*\d+\s*[)）]|(?:一|二|三|四|五|六|七|八|九|十)+[、.])/;
    // 章节分类标题匹配：匹配形如 "# 计算机网络" "【章节：xxx】" "--- 模块一 ---"
    var CAT_HEADER_RE = /^[\s_]*(?:#+\s*|【\s*|---+\s*)([^#【】\r\n\-]+?)(?:\s*】|\s*---+)?$/;

    function commitCurBlock() {
      if (curBlock.length === 0) return;
      var q = parseSingleQuestionBlock(curBlock, questions.length + 1, currentCat);
      if (q && q.stem && q.stem.trim().length >= 2) {
        if (q.warnings && q.warnings.length > 0) {
          q.warnings.forEach(function (w) {
            warnings.push('第 ' + (questions.length + 1) + ' 题：' + w);
          });
        }
        questions.push(q);
      } else if (curBlock.length > 0) {
        var discarded = curBlock.join(' ').trim();
        if (discarded && discarded.length > 3) {
          warnings.push('已安全跳过无法解析的文本残片/噪音：' + (discarded.length > 30 ? discarded.slice(0, 30) + '...' : discarded));
        }
      }
      curBlock = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var rawLine = lines[i];
      var trimmed = rawLine.trim();

      if (!trimmed) {
        // 空行作为自然题与题之间的分割线（但若块内只有题干，继续保留）
        if (curBlock.length >= 2) {
          commitCurBlock();
        }
        continue;
      }

      // 过滤水印或页码等常见干扰噪音
      var isNoise = /^[—\-\s]*第?\s*\d+\s*(?:页|\/|\-)[^\n]*$/i.test(trimmed) ||
                    /.*(?:微信公众号|内部资料|严禁翻印|试卷绝密|关注微信|天天刷题).*/i.test(trimmed);
      if (isNoise) {
        warnings.push('已自动清洗过滤 1 处水印/页码干扰行：' + (trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed));
        continue;
      }

      // 提取题库名称标注 (若前几行形如 "题库：xxx" 或 "题库名称：xxx" 或 "试卷：xxx")
      if (i < 3 && !bankName) {
        var bankNameMatch = trimmed.match(/^[\s_]*(?:题库(?:名称)?|试卷(?:名称)?|Title|Bank\s*Name)\s*[:：]\s*(.*)$/i);
        if (bankNameMatch && bankNameMatch[1].trim()) {
          bankName = bankNameMatch[1].trim();
          continue;
        }
      }

      // 检查大类章节标题
      var catHeaderMatch = trimmed.match(CAT_HEADER_RE);
      if (catHeaderMatch && !OPT_LINE_RE.test(trimmed) && !ANS_LINE_RE.test(trimmed) && !Q_START_RE.test(trimmed)) {
        var potentialCat = catHeaderMatch[1].trim();
        // 排除过长的普通文本
        if (potentialCat.length >= 2 && potentialCat.length <= 25) {
          commitCurBlock();
          currentCat = potentialCat;
          continue;
        }
      }

      // 检查新试题开始
      if (Q_START_RE.test(trimmed)) {
        commitCurBlock();
        curBlock.push(trimmed);
      } else {
        if (curBlock.length > 0) {
          curBlock.push(trimmed);
        } else {
          // 容错：可能首题没有题号，直接以题干开头
          curBlock.push(trimmed);
        }
      }
    }

    // 提交最后一个块
    commitCurBlock();

    // 重新编号
    questions.forEach(function (q, idx) {
      q.id = idx + 1;
    });

    return normalizeFromQuestionsArray(questions, bankName || defaultBankName, warnings);
  }

  /**
   * 规范化题库对象并统计元数据
   */
  function normalizeFromQuestionsArray(questions, bankName, extraWarnings) {
    var singleCount = 0;
    var judgeCount = 0;
    var catsSet = {};
    var cats = [];
    var allWarnings = (extraWarnings || []).slice();

    questions.forEach(function (q) {
      if (q.type === 'judge') judgeCount++;
      else singleCount++;

      var cat = q.cat || '综合';
      if (!catsSet[cat]) {
        catsSet[cat] = true;
        cats.push(cat);
      }

      if (q.warnings && q.warnings.length > 0 && (!extraWarnings || extraWarnings.length === 0)) {
        q.warnings.forEach(function (w) {
          allWarnings.push('第 ' + q.id + ' 题：' + w);
        });
      }
    });

    return {
      meta: {
        name: bankName || '自定义题库',
        total: questions.length,
        single: singleCount,
        judge: judgeCount,
        cats: cats.length > 0 ? cats : ['综合']
      },
      questions: questions,
      warnings: allWarnings
    };
  }

  function normalizeFromFullBank(bank, defaultBankName) {
    var name = (bank.meta && bank.meta.name) || bank.name || defaultBankName || '自定义题库';
    var res = normalizeFromQuestionsArray(bank.questions, name);
    if (bank.meta && bank.meta.description) {
      res.meta.description = bank.meta.description;
    }
    return res;
  }

  /**
   * 生成开箱即用的简易导入模板示例文本
   */
  function getSampleTemplateText() {
    return [
      '# 计算机基础与通用常识示范题库',
      '',
      '1. 道德是通过（ ）对一个人的品行发生极大的作用。',
      'A. 社会舆论',
      'B. 国家强制执行',
      'C. 个人的影响',
      'D. 国家政策',
      '答案：A',
      '分类：职业道德',
      '解析：道德依靠社会舆论、传统习俗和内心信念起作用。',
      '',
      '2. 计算机中用于临时存储正在运行的程序和数据的部件是（ ）。',
      'A. 随机存取存储器（RAM）',
      'B. 只读存储器（ROM）',
      'C. 固态硬盘（SSD）',
      'D. 运算器',
      '答案：A',
      '分类：计算机硬件',
      '解析：RAM 俗称内存，存取速度极快但断电后数据易失。',
      '',
      '3. 在太阳系中，体积和质量最大的行星是（ ）。',
      'A. 火星',
      'B. 木星',
      'C. 土星',
      'D. 金星',
      '答案：B',
      '分类：天文科普',
      '解析：木星是太阳系行星之王，体积是地球的1300倍。',
      '',
      '4. Python 是一种解释型脚本语言。（ ）',
      '答案：正确',
      '分类：编程基础',
      '解析：Python由解释器逐行执行字节码，具备优秀的跨平台性。',
      '',
      '5. 光在真空中的传播速度小于声音在空气中的传播速度。',
      '答案：错误',
      '分类：物理常识',
      '解析：光在真空中速度约30万公里/秒，远超常温常压下声速（约340米/秒）。'
    ].join('\n');
  }

  // 挂载到环境
  global.QuestionParser = {
    parseText: parseText,
    parseCsv: parseCsv,
    normalizeStem: normalizeStem,
    getSampleTemplateText: getSampleTemplateText
  };

})(typeof window !== 'undefined' ? window : global);
