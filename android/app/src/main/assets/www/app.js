/* ============================================================
 * 通用智能刷题器 · 核心业务逻辑 (Universal Quiz Core)
 * ============================================================ */
(function () {
  'use strict';

  var STORE_PREFIX = 'uquiz_v2';
  var DB = null;              // 当前活跃题库数据 { meta: {...}, questions: [...] }
  var BY_ID = {};             // 当前题库题目字典 qid -> question
  var ACTIVE_BANK_ID = null;  // 当前题库 ID

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    return m < 1 ? sec + ' 秒' : m + ' 分 ' + (sec % 60) + ' 秒';
  }

  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  /* ============================================================
   * 1. 题干括号与答案填空动态格式化 (Smart Bracket Engine)
   * ============================================================ */
  function formatStem(stem, opts, answerIdx, pickIdx, isRecite, answered, isExam) {
    if (!stem) return '';
    var bracketRe = /[（(][\s_]*[)）]/g;
    var matches = stem.match(bracketRe);
    if (!matches) {
      return esc(stem);
    }

    var isFilled = false;
    var letter = '';
    var text = '';

    if (isExam) {
      if (pickIdx !== undefined && pickIdx !== null && pickIdx >= 0 && opts && opts[pickIdx] !== undefined) {
        isFilled = true;
        letter = LETTERS[pickIdx] || '';
        text = opts[pickIdx];
      }
    } else if (isRecite || answered) {
      if (answerIdx !== undefined && answerIdx !== null && answerIdx >= 0 && opts && opts[answerIdx] !== undefined) {
        isFilled = true;
        letter = LETTERS[answerIdx] || '';
        text = opts[answerIdx];
      }
    }

    var parts = stem.split(bracketRe);
    if (!isFilled) {
      var blankHtml = '<span class="stem-bracket blank">（&nbsp;&nbsp;&nbsp;&nbsp;）</span>';
      return parts.map(esc).join(blankHtml);
    }

    var cls = isExam ? 'stem-bracket filled cur' : 'stem-bracket filled ok';

    // 多空特殊处理 (若答案含有逗号且有多空)
    if (matches.length > 1 && (text.indexOf('，') !== -1 || text.indexOf(',') !== -1)) {
      var subs = text.indexOf('，') !== -1 ? text.split('，') : text.split(',');
      var res = '';
      for (var i = 0; i < parts.length; i++) {
        res += esc(parts[i]);
        if (i < matches.length) {
          var subText = subs[i] !== undefined ? subs[i] : text;
          var subLetter = (i === 0 && letter) ? '<b class="bracket-letter">' + letter + '</b> · ' : '';
          res += '<span class="' + cls + '">（' + subLetter + '<span class="bracket-text">' + esc(subText) + '</span>）</span>';
        }
      }
      return res;
    }

    // 单空标准填充：包含选项字母与选项文本
    var contentHtml = '<b class="bracket-letter">' + letter + '</b>';
    if (text) {
      contentHtml += '<span class="bracket-text"> · ' + esc(text) + '</span>';
    }
    var filledHtml = '<span class="' + cls + '">（' + contentHtml + '）</span>';
    return parts.map(esc).join(filledHtml);
  }

  /* ============================================================
   * 2. 题库管理器 (BankManager) - 多题库无缝切换与持久化
   * ============================================================ */
  var BankManager = {
    banks: [], // 题库元数据与实体列表

    init: function () {
      this.banks = [];

      // 1. 载入系统预设题库 (Builtin)
      if (window.BUILTIN_BANKS && Array.isArray(window.BUILTIN_BANKS)) {
        window.BUILTIN_BANKS.forEach(function (b) {
          BankManager.banks.push({
            id: b.id,
            name: b.name,
            desc: b.desc || '',
            icon: b.icon || '📚',
            isBuiltin: true,
            createdAt: '系统预设',
            data: b.data
          });
        });
      }

      // 2. 载入本地自定义题库
      try {
        var customList = JSON.parse(localStorage.getItem(STORE_PREFIX + '_custom_banks') || '[]');
        if (Array.isArray(customList)) {
          customList.forEach(function (b) {
            BankManager.banks.push(b);
          });
        }
      } catch (e) {
        console.error('加载本地自定义题库出错:', e);
      }

      // 3. 确定当前活跃题库 ID
      var savedActiveId = localStorage.getItem(STORE_PREFIX + '_active_bank');
      var matched = this.banks.find(function (b) { return b.id === savedActiveId; });
      if (matched) {
        ACTIVE_BANK_ID = matched.id;
      } else if (this.banks.length > 0) {
        ACTIVE_BANK_ID = this.banks[0].id;
      } else {
        ACTIVE_BANK_ID = null;
      }

      this.applyActiveBank();
    },

    getActiveBank: function () {
      return this.banks.find(function (b) { return b.id === ACTIVE_BANK_ID; }) || this.banks[0];
    },

    applyActiveBank: function () {
      var active = this.getActiveBank();
      if (!active || !active.data) return;

      DB = active.data;
      BY_ID = {};
      if (DB.questions && Array.isArray(DB.questions)) {
        DB.questions.forEach(function (q) { BY_ID[q.id] = q; });
      }

      localStorage.setItem(STORE_PREFIX + '_active_bank', ACTIVE_BANK_ID);
      Store.loadForBank(ACTIVE_BANK_ID);
    },

    switchBank: function (bankId) {
      if (bankId === ACTIVE_BANK_ID) {
        this.closeDrawer();
        return;
      }
      var target = this.banks.find(function (b) { return b.id === bankId; });
      if (!target) {
        Toast.show('未找到目标题库');
        return;
      }
      ACTIVE_BANK_ID = bankId;
      this.applyActiveBank();
      this.closeDrawer();
      Home.render();
      Toast.show('已切换至：' + target.name);
    },

    addBank: function (bankObj, activateImmediately) {
      if (!bankObj || !bankObj.data || !bankObj.data.questions) {
        Toast.show('题库数据无效');
        return false;
      }

      var id = 'bank_custom_' + Date.now();
      var newBank = {
        id: id,
        name: bankObj.name || (bankObj.data.meta && bankObj.data.meta.name) || '自定义题库',
        desc: bankObj.desc || (bankObj.data.meta && bankObj.data.meta.desc) || (bankObj.data.questions.length + '道试题'),
        icon: '📚',
        isBuiltin: false,
        createdAt: fmtDate(new Date()),
        data: bankObj.data
      };

      this.banks.push(newBank);
      this.saveCustomBanks();

      if (activateImmediately !== false) {
        ACTIVE_BANK_ID = id;
        this.applyActiveBank();
        Home.render();
      }

      return id;
    },

    saveCustomBanks: function () {
      var customOnly = this.banks.filter(function (b) { return !b.isBuiltin; });
      try {
        localStorage.setItem(STORE_PREFIX + '_custom_banks', JSON.stringify(customOnly));
      } catch (e) {
        Toast.show('存储空间受限，未能完全缓存');
      }
    },

    deleteBank: function (bankId) {
      var b = this.banks.find(function (x) { return x.id === bankId; });
      if (!b) return;
      if (b.isBuiltin) {
        Toast.show('系统内置题库不支持删除');
        return;
      }

      var self = this;
      Modal.show('删除题库确认', '确定要彻底删除题库【' + b.name + '】吗？该题库的所有刷题记录都将被清空。', function () {
        self.banks = self.banks.filter(function (x) { return x.id !== bankId; });
        self.saveCustomBanks();
        Store.removeBankData(bankId);

        if (ACTIVE_BANK_ID === bankId) {
          ACTIVE_BANK_ID = self.banks.length > 0 ? self.banks[0].id : null;
          self.applyActiveBank();
        }
        self.renderDrawerList();
        Home.render();
        Toast.show('已删除题库：' + b.name);
      });
    },

    exportBank: function (bankId) {
      var b = this.banks.find(function (x) { return x.id === bankId; });
      if (!b || !b.data) return;

      var dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(b.data, null, 2));
      var downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', (b.name || '题库') + '.json');
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      Toast.show('题库导出成功');
    },

    openDrawer: function () {
      this.renderDrawerList();
      $('bank-mask').classList.add('on');
      $('bank-drawer').classList.add('on');
    },

    closeDrawer: function () {
      $('bank-mask').classList.remove('on');
      $('bank-drawer').classList.remove('on');
    },

    renderDrawerList: function () {
      var container = $('bank-list-container');
      if (!container) return;
      var html = '';

      this.banks.forEach(function (b) {
        var isActive = (b.id === ACTIVE_BANK_ID);
        var qCount = (b.data && b.data.questions) ? b.data.questions.length : 0;
        var singleCount = (b.data && b.data.meta && b.data.meta.single !== undefined) ? b.data.meta.single : 0;
        var judgeCount = (b.data && b.data.meta && b.data.meta.judge !== undefined) ? b.data.meta.judge : 0;

        var counts = Store.getCountsForBank(b.id, qCount);
        var pct = qCount > 0 ? Math.round((counts.done / qCount) * 100) : 0;

        html += '<div class="bank-item-card ' + (isActive ? 'active-bank' : '') + '">';
        html += '  <div class="bank-header">';
        html += '    <div class="bank-title-row">';
        html += '      <span style="font-size:20px">' + (b.icon || '📚') + '</span>';
        html += '      <span class="bank-name">' + esc(b.name) + '</span>';
        html += '    </div>';
        if (isActive) {
          html += '    <span class="bank-tag builtin" style="background:var(--brand-light);color:var(--brand)">当前正在刷</span>';
        } else {
          html += '    <span class="bank-tag ' + (b.isBuiltin ? 'builtin' : 'custom') + '">' + (b.isBuiltin ? '官方预设' : '自定义') + '</span>';
        }
        html += '  </div>';

        html += '  <div class="bank-desc">' + esc(b.desc || '包含各类精选题库') + '</div>';

        html += '  <div class="bank-meta-row">';
        html += '    <span>试题总数: <b>' + qCount + '</b> 题</span>';
        html += '    <span>(单选 ' + singleCount + ' / 判断 ' + judgeCount + ')</span>';
        html += '    <span>练习进度: <b>' + pct + '%</b></span>';
        html += '  </div>';

        html += '  <div class="bank-actions-row">';
        if (!isActive) {
          html += '    <button class="btn-compact primary" onclick="BankManager.switchBank(\'' + b.id + '\')">切换此题库</button>';
        }
        html += '    <button class="btn-compact" onclick="BankManager.exportBank(\'' + b.id + '\')">导出JSON</button>';
        if (!b.isBuiltin) {
          html += '    <button class="btn-compact" style="color:var(--err)" onclick="BankManager.deleteBank(\'' + b.id + '\')">删除</button>';
        }
        html += '  </div>';
        html += '</div>';
      });

      container.innerHTML = html;
    }
  };

  /* ============================================================
   * 3. 题库导入工作台逻辑 (ImportUI)
   * ============================================================ */
  var ImportUI = {
    curTab: 'text',
    parsedResult: null,
    debounceTimer: null,

    init: function () {
      var textarea = $('import-textarea');
      if (textarea) {
        var self = this;
        textarea.addEventListener('input', function () {
          clearTimeout(self.debounceTimer);
          self.debounceTimer = setTimeout(function () {
            self.triggerParse();
          }, 150);
        });
      }

      var dropzone = $('file-dropzone');
      if (dropzone) {
        dropzone.addEventListener('dragover', function (e) {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', function () {
          dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', function (e) {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            ImportUI.readFile(e.dataTransfer.files[0]);
          }
        });
      }
    },

    switchTab: function (tab) {
      this.curTab = tab;
      ['text', 'file', 'json', 'spec'].forEach(function (t) {
        var btn = $('tab-import-' + t);
        var panel = $('panel-import-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = (t === tab ? 'block' : 'none');
      });
    },

    fillTemplate: function () {
      var sample = QuestionParser.getSampleTemplateText();
      $('import-textarea').value = sample;
      if (!$('inp-bank-name').value) {
        $('inp-bank-name').value = '计算机基础与通用常识示范题库';
      }
      this.triggerParse();
      Toast.show('已填入标准范例，支持单选与判断');
    },

    clearText: function () {
      $('import-textarea').value = '';
      this.triggerParse();
    },

    triggerParse: function () {
      var text = ($('import-textarea').value || '').trim();
      var defaultName = ($('inp-bank-name').value || '').trim() || '自定义新题库';

      if (!text) {
        this.parsedResult = null;
        $('stat-parsed-total').innerText = '0';
        $('stat-parsed-single').innerText = '0';
        $('stat-parsed-judge').innerText = '0';
        $('stat-parsed-cats').innerText = '0';
        $('stat-parsed-status').style.display = 'none';
        $('preview-count-tip').innerText = '未输入内容';
        $('import-preview-box').innerHTML = '<div style="text-align:center;padding:26px 10px;font-size:12.5px;color:var(--text-3)">输入或粘贴文本后，将在此实时生成试题卡片与填空预览</div>';
        return;
      }

      var res = QuestionParser.parseText(text, defaultName);
      this.parsedResult = res;

      // 更新状态指示
      $('stat-parsed-total').innerText = res.meta.total;
      $('stat-parsed-single').innerText = res.meta.single;
      $('stat-parsed-judge').innerText = res.meta.judge;
      $('stat-parsed-cats').innerText = res.meta.cats.length;
      $('stat-parsed-status').style.display = res.meta.total > 0 ? 'inline-flex' : 'none';
      $('preview-count-tip').innerText = '共识别 ' + res.meta.total + ' 题 (已展示前 5 题预览)';

      // 诊断信息反馈
      var diagBar = $('import-diag-bar');
      if (diagBar) {
        if (res.warnings && res.warnings.length > 0) {
          diagBar.style.display = 'block';
          $('import-diag-count').innerText = res.warnings.length + ' 处缺陷已修复';
          $('import-diag-list').innerHTML = res.warnings.map(function (w) {
            return '<div style="margin-bottom:3px">• ' + esc(w) + '</div>';
          }).join('');
          $('stat-parsed-status').className = 'import-status-chip';
          $('stat-parsed-status').style.background = 'rgba(245, 158, 11, 0.15)';
          $('stat-parsed-status').style.color = '#d97706';
          $('stat-parsed-status').innerHTML = '⚠️ 容错修复中';
        } else {
          diagBar.style.display = 'none';
          $('stat-parsed-status').className = 'import-status-chip ok';
          $('stat-parsed-status').style.background = '';
          $('stat-parsed-status').style.color = '';
          $('stat-parsed-status').innerHTML = '✅ 格式合规';
        }
      }

      // 自动提取题库名称（如果用户尚未自定义或为默认占位）
      if ((!$('inp-bank-name').value || $('inp-bank-name').value === '自定义新题库') && res.meta.name && res.meta.name !== '自定义题库' && res.meta.name !== '自定义新题库') {
        $('inp-bank-name').value = res.meta.name;
      }

      this.renderPreviewCards(res.questions.slice(0, 5));
    },

    setPreviewAnswer: function (qIdx, ansIdx) {
      if (!this.parsedResult || !this.parsedResult.questions || !this.parsedResult.questions[qIdx]) return;
      var q = this.parsedResult.questions[qIdx];
      q.answer = ansIdx;
      // 清理缺失答案警告
      if (q.warnings) {
        q.warnings = q.warnings.filter(function (w) { return w.indexOf('缺失标准答案') === -1; });
      }
      this.renderPreviewCards(this.parsedResult.questions.slice(0, 5));
      Toast.show('已将第 ' + (qIdx + 1) + ' 题答案修改为 ' + (q.type === 'judge' ? (ansIdx === 0 ? '正确' : '错误') : LETTERS[ansIdx]));
    },

    renderPreviewCards: function (questions) {
      var box = $('import-preview-box');
      if (!box) return;

      if (!questions || questions.length === 0) {
        box.innerHTML = '<div style="text-align:center;padding:20px;font-size:12.5px;color:var(--text-3)">未识别出有效试题，请检查文本格式</div>';
        return;
      }

      var html = '';
      questions.forEach(function (q, idx) {
        var hasWarning = q.warnings && q.warnings.length > 0;
        html += '<div class="import-preview-item" style="' + (hasWarning ? 'border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.02)' : '') + '">';
        html += '  <div class="import-preview-header">';
        html += '    <span><b>第 ' + (idx + 1) + ' 题</b> · ' + (q.type === 'judge' ? '判断题' : '单选题') + '</span>';
        if (hasWarning) {
          html += '    <span class="bank-tag" style="background:#fef3c7;color:#b45309;border-color:rgba(217,119,6,0.25);margin-left:auto;margin-right:6px">⚠️ ' + esc(q.warnings[0]) + '</span>';
        }
        html += '    <span class="bank-tag">' + esc(q.cat || '综合') + '</span>';
        html += '  </div>';

        // 题干括号渲染
        var formattedStem = formatStem(q.stem, q.opts, q.answer, null, true, true, false);
        html += '  <div class="import-preview-stem">' + formattedStem + '</div>';

        html += '  <div class="import-preview-opts">';
        (q.opts || []).forEach(function (opt, oIdx) {
          var isAns = (oIdx === q.answer);
          html += '    <div class="import-preview-opt ' + (isAns ? 'is-correct' : '') + '" style="cursor:pointer" onclick="ImportUI.setPreviewAnswer(' + idx + ', ' + oIdx + ')" title="点击可直接将此项设为正确答案">';
          html += '      <b>' + LETTERS[oIdx] + '.</b> ' + esc(opt);
          if (isAns) {
            html += ' <span style="font-weight:600;margin-left:6px;color:#16a34a">✓ (当前答案)</span>';
          } else {
            html += ' <span style="font-size:11px;color:var(--text-3);opacity:0.5;margin-left:auto">(点击设为答案)</span>';
          }
          html += '    </div>';
        });
        html += '  </div>';

        if (q.explain) {
          html += '  <div style="margin-top:6px;font-size:11.5px;color:var(--text-2);background:rgba(0,0,0,0.03);padding:4px 8px;border-radius:4px">';
          html += '    💡 <b>解析：</b>' + esc(q.explain);
          html += '  </div>';
        }

        html += '</div>';
      });

      box.innerHTML = html;
    },

    handleFileSelect: function (e) {
      if (e.target && e.target.files && e.target.files[0]) {
        this.readFile(e.target.files[0]);
      }
    },

    readFile: function (file) {
      var self = this;
      var reader = new FileReader();
      var fileName = file.name.replace(/\.[^/.]+$/, '');

      reader.onload = function (ev) {
        var content = ev.target.result;
        // 如果是 json 文件
        if (file.name.endsWith('.json')) {
          try {
            var j = JSON.parse(content);
            $('json-textarea').value = JSON.stringify(j, null, 2);
            self.switchTab('json');
            Toast.show('已成功加载 JSON 文件');
            return;
          } catch (e) {}
        }

        // 默认作为文本填入简易导入框
        $('inp-bank-name').value = fileName;
        $('import-textarea').value = content;
        self.switchTab('text');
        self.triggerParse();
        Toast.show('已成功载入文件【' + file.name + '】并解析');
      };

      reader.readAsText(file, 'utf-8');
    },

    confirmImport: function () {
      if (!this.parsedResult || !this.parsedResult.questions || this.parsedResult.questions.length === 0) {
        Toast.show('请先输入或粘贴题库内容');
        return;
      }

      var customName = ($('inp-bank-name').value || '').trim() || this.parsedResult.meta.name || '我的导入题库';
      var customDesc = ($('inp-bank-desc').value || '').trim() || ('共 ' + this.parsedResult.questions.length + ' 道题目');

      var bankData = {
        meta: Object.assign({}, this.parsedResult.meta, { name: customName, desc: customDesc }),
        questions: this.parsedResult.questions
      };

      var newId = BankManager.addBank({
        name: customName,
        desc: customDesc,
        data: bankData
      }, true);

      if (newId) {
        Toast.show('🎉 题库导入成功！已自动切换为当前题库');
        Nav.goto('home', true);
      }
    },

    confirmJsonImport: function () {
      var raw = ($('json-textarea').value || '').trim();
      if (!raw) {
        Toast.show('请粘贴 JSON 内容');
        return;
      }
      try {
        var parsed = JSON.parse(raw);
        var norm = QuestionParser.parseText(raw);
        if (!norm || !norm.questions || norm.questions.length === 0) {
          Toast.show('JSON 中未找到合法试题');
          return;
        }

        var bankName = (parsed.meta && parsed.meta.name) || norm.meta.name || 'JSON导入题库';
        var bankDesc = (parsed.meta && parsed.meta.description) || (norm.questions.length + ' 道题目');

        BankManager.addBank({
          name: bankName,
          desc: bankDesc,
          data: norm
        }, true);

        Toast.show('🎉 JSON题库导入成功！');
        Nav.goto('home', true);
      } catch (e) {
        Toast.show('JSON 格式有误，请检查语法');
      }
    },

    copySpecTemplate: function () {
      var sample = QuestionParser.getSampleTemplateText();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(sample).then(function () {
          Toast.show('已复制标准格式模板至剪贴板');
        });
      } else {
        Toast.show('请手动复制规范区域内容');
      }
    }
  };

  /* ============================================================
   * 4. 数据持久化 (Store) - 每个题库独立存储进度与错题
   * ============================================================ */
  var Store = {
    bankId: null,
    data: null,

    loadForBank: function (bankId) {
      this.bankId = bankId;
      var raw = null;
      try {
        raw = JSON.parse(localStorage.getItem(STORE_PREFIX + '_data_' + bankId) || '{}');
      } catch (e) { raw = {}; }

      this.data = raw || {};
      if (!this.data.rec) this.data.rec = {};
      if (!this.data.fav) this.data.fav = {};
      if (!this.data.exams) this.data.exams = [];
      if (!this.data.wrongs) this.data.wrongs = {};
      if (this.data.orderProgress === undefined) this.data.orderProgress = 0;
      return this.data;
    },

    save: function () {
      if (!this.bankId || !this.data) return;
      try {
        localStorage.setItem(STORE_PREFIX + '_data_' + this.bankId, JSON.stringify(this.data));
      } catch (e) {
        Toast.show('存储空间不足');
      }
    },

    getCountsForBank: function (bankId, totalCount) {
      try {
        var raw = JSON.parse(localStorage.getItem(STORE_PREFIX + '_data_' + bankId) || '{}');
        var rec = raw.rec || {};
        return { done: Object.keys(rec).length };
      } catch (e) {
        return { done: 0 };
      }
    },

    removeBankData: function (bankId) {
      try {
        localStorage.removeItem(STORE_PREFIX + '_data_' + bankId);
      } catch (e) {}
    },

    saveOrderProgress: function (idx) {
      if (!this.data) return;
      this.data.orderProgress = idx;
      this.save();
    },

    getOrderProgress: function () {
      if (!this.data) return 0;
      return typeof this.data.orderProgress === 'number' ? this.data.orderProgress : 0;
    },

    clearOrderRecords: function () {
      if (!this.data) return;
      this.data.rec = {};
      this.data.orderProgress = 0;
      this.save();
    },

    mark: function (qid, pick) {
      if (!this.data) return;
      this.data.rec[qid] = pick;
      var q = BY_ID[qid];
      if (q && pick !== undefined && pick !== null) {
        if (pick !== q.answer) {
          this.addWrong(qid);
        }
      }
      this.save();
    },

    addWrong: function (qid) {
      if (!this.data) return;
      if (!this.data.wrongs) this.data.wrongs = {};
      this.data.wrongs[qid] = true;
      this.save();
    },

    removeWrong: function (qid) {
      if (!this.data) return;
      if (this.data.wrongs && this.data.wrongs[qid]) {
        delete this.data.wrongs[qid];
        this.save();
      }
    },

    isWrong: function (qid) {
      return !!(this.data && this.data.wrongs && this.data.wrongs[qid]);
    },

    answered: function (qid) {
      return this.data && this.data.rec[qid] !== undefined && this.data.rec[qid] !== null;
    },

    isCorrect: function (qid) {
      if (!this.answered(qid)) return null;
      var q = BY_ID[qid];
      return q ? this.data.rec[qid] === q.answer : null;
    },

    counts: function () {
      if (!this.data) return { done: 0, ok: 0 };
      var ids = Object.keys(this.data.rec), ok = 0;
      for (var i = 0; i < ids.length; i++) {
        if (this.isCorrect(ids[i])) ok++;
      }
      return { done: ids.length, ok: ok };
    },

    wrongIds: function () {
      if (!this.data || !this.data.wrongs) return [];
      var out = [];
      for (var k in this.data.wrongs) {
        if (this.data.wrongs[k]) out.push(+k);
      }
      return out.sort(function (a, b) { return a - b; });
    },

    favIds: function () {
      if (!this.data || !this.data.fav) return [];
      var out = [];
      for (var k in this.data.fav) {
        if (this.data.fav[k]) out.push(+k);
      }
      return out.sort(function (a, b) { return a - b; });
    },

    isFav: function (qid) {
      return !!(this.data && this.data.fav && this.data.fav[qid]);
    },

    toggleFav: function (qid) {
      if (!this.data) return false;
      if (this.data.fav[qid]) delete this.data.fav[qid];
      else this.data.fav[qid] = true;
      this.save();
      return !!this.data.fav[qid];
    },

    addExam: function (record) {
      if (!this.data) return;
      if (!this.data.exams) this.data.exams = [];
      this.data.exams.unshift(record);
      if (this.data.exams.length > 30) this.data.exams.pop();
      this.save();
    },

    examList: function () {
      return (this.data && this.data.exams) || [];
    }
  };

  /* ============================================================
   * 5. 特效引擎 (FX) - 粒子与礼花
   * ============================================================ */
  var FX = {
    canvas: null,
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1,
    particles: [],
    running: false,

    init: function () {
      this.canvas = $('fx-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      var self = this;
      window.addEventListener('resize', function () { self.resize(); });
    },

    resize: function () {
      if (!this.canvas) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth || document.documentElement.clientWidth || 360;
      this.h = window.innerHeight || document.documentElement.clientHeight || 640;
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      if (this.ctx) {
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
    },

    burst: function (x, y) {
      if (!this.canvas || !this.ctx) this.init();
      if (!this.ctx) return;

      if (typeof x !== 'number' || isNaN(x)) x = this.w / 2;
      if (typeof y !== 'number' || isNaN(y)) y = this.h / 2;

      var colors = ['#10b981', '#34d399', '#f59e0b', '#fbbf24', '#3b82f6'];
      var count = 16;
      for (var i = 0; i < count; i++) {
        var angle = (Math.PI * 2 * i) / count + (Math.random() * 0.4 - 0.2);
        var speed = 3.2 + Math.random() * 4.2;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 3 + Math.random() * 2.5,
          alpha: 1,
          decay: 0.032 + Math.random() * 0.018,
          gravity: 0.16,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.2,
          isStar: (i % 2 === 0)
        });
      }
      this.start();
    },

    confetti: function (isSuper) {
      if (!this.canvas || !this.ctx) this.init();
      if (!this.ctx) return;

      var colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#fbbf24'];
      var count = isSuper ? 115 : 75;

      for (var i = 0; i < count; i++) {
        var fromLeft = (i % 2 === 0);
        var startX = fromLeft ? (this.w * 0.12 + (Math.random() - 0.5) * 40) : (this.w * 0.88 + (Math.random() - 0.5) * 40);
        var startY = this.h * 0.88 + Math.random() * 40;
        var angle = fromLeft ? (-Math.PI / 4 + (Math.random() - 0.5) * 0.45) : (-Math.PI * 3 / 4 + (Math.random() - 0.5) * 0.45);
        var speed = 12 + Math.random() * 11;

        this.particles.push({
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: colors[Math.floor(Math.random() * colors.length)],
          w: 6 + Math.random() * 5,
          h: 9 + Math.random() * 7,
          alpha: 1,
          decay: 0.007 + Math.random() * 0.007,
          gravity: 0.26,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.22,
          flutter: Math.random() * Math.PI,
          flutterSpeed: 0.08 + Math.random() * 0.08,
          isRibbon: true
        });
      }
      this.start();
    },

    start: function () {
      if (this.running) return;
      this.running = true;
      var self = this;
      function loop() {
        if (!self.running) return;
        self.update();
        if (self.particles.length > 0) {
          requestAnimationFrame(loop);
        } else {
          self.running = false;
          if (self.ctx) self.ctx.clearRect(0, 0, self.w, self.h);
        }
      }
      requestAnimationFrame(loop);
    },

    update: function () {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.w, this.h);

      var next = [];
      for (var i = 0; i < this.particles.length; i++) {
        var p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.alpha -= p.decay;
        p.rotation += p.rotSpeed;

        if (p.alpha > 0.02 && p.y < this.h + 50) {
          next.push(p);
          this.ctx.save();
          this.ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
          this.ctx.fillStyle = p.color;

          if (p.isRibbon) {
            p.flutter += p.flutterSpeed;
            var curW = p.w * Math.cos(p.flutter);
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rotation);
            this.ctx.fillRect(-curW / 2, -p.h / 2, curW, p.h);
          } else if (p.isStar) {
            this.ctx.translate(p.x, p.y);
            this.ctx.beginPath();
            this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            this.ctx.fill();
          } else {
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rotation);
            this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          }
          this.ctx.restore();
        }
      }
      this.particles = next;
    }
  };

  /* ============================================================
   * 6. 首页逻辑 (Home)
   * ============================================================ */
  var Home = {
    render: function () {
      var activeBank = BankManager.getActiveBank();
      var bName = activeBank ? activeBank.name : '通用刷题器';
      var bDesc = activeBank ? activeBank.desc : '理论考证真题练习';

      $('cur-bank-name').innerText = bName;
      $('cur-bank-icon').innerText = activeBank.icon || '📚';
      $('home-title').innerText = bName;
      $('home-desc').innerText = bDesc;
      $('foot-bank-name').innerText = bName;

      var total = (DB && DB.questions) ? DB.questions.length : 0;
      var c = Store.counts();
      var pct = total ? Math.round((c.done / total) * 100) : 0;
      var rate = c.done ? Math.round((c.ok / c.done) * 100) + '%' : '—';

      $('st-total').innerText = total;
      $('st-done').innerText = pct + '%';
      $('st-rate').innerText = rate;
      $('foot-total').innerText = total;

      $('prog-txt').innerText = '已练习 ' + c.done + ' / ' + total + ' 题';
      $('prog-bar').style.width = pct + '%';

      var curOrderIdx = Store.getOrderProgress();
      if (curOrderIdx > 0 && curOrderIdx < total) {
        $('order-sub').innerText = '继续上次练习（第 ' + (curOrderIdx + 1) + ' 题）';
      } else {
        $('order-sub').innerText = '按题库顺序逐题作答，记忆学习';
      }

      var wCount = Store.wrongIds().length;
      $('wrong-sub').innerText = wCount ? ('攻克 ' + wCount + ' 道易错试题') : '暂无错题记录，保持优秀！';

      var fCount = Store.favIds().length;
      $('fav-sub').innerText = fCount ? ('已收藏 ' + fCount + ' 道重点题目') : '标记重点题目随时复看';

      // 渲染分类列表
      var catBox = $('cat-list');
      if (catBox) {
        var cats = (DB && DB.meta && DB.meta.cats) || [];
        var html = '';
        cats.forEach(function (cat) {
          var inCat = (DB.questions || []).filter(function (q) { return q.cat === cat; });
          var done = inCat.filter(function (q) { return Store.answered(q.id); }).length;
          var catPct = inCat.length ? Math.round((done / inCat.length) * 100) : 0;

          html += '<div class="cat-item" onclick="Home.startCat(\'' + esc(cat) + '\')">';
          html += '  <div class="ci-head">';
          html += '    <span>' + esc(cat) + '</span>';
          html += '    <small>' + done + ' / ' + inCat.length + ' 题</small>';
          html += '  </div>';
          html += '  <div class="ci-bar"><i style="width:' + catPct + '%"></i></div>';
          html += '</div>';
        });
        catBox.innerHTML = html || '<div style="padding:10px;text-align:center;font-size:12.5px;color:var(--text-3)">暂无分类</div>';
      }
    },

    startPractice: function (mode) {
      if (!DB || !DB.questions || DB.questions.length === 0) {
        Toast.show('当前题库无试题，请先导入');
        return;
      }
      var list = DB.questions.slice();
      var title = '基础练习';
      var startIdx = 0;

      if (mode === 'random') {
        list = shuffle(list);
        title = '随机练习';
      } else if (mode === 'order') {
        var savedIdx = Store.getOrderProgress();
        if (savedIdx >= 0 && savedIdx < list.length) {
          startIdx = savedIdx;
        }
      }

      Practice.enter({
        mode: mode,
        title: title,
        list: list,
        idx: startIdx,
        isOrder: (mode === 'order')
      });
    },

    startCat: function (cat) {
      if (!DB || !DB.questions) return;
      var inCat = DB.questions.filter(function (q) { return q.cat === cat; });
      if (!inCat.length) {
        Toast.show('该分类下暂无试题');
        return;
      }
      Practice.enter({
        mode: 'cat',
        title: cat,
        list: inCat,
        idx: 0,
        isOrder: false
      });
    },

    goto: function (scr) {
      Nav.goto(scr);
    }
  };

  /* ============================================================
   * 7. 练习器 (Practice)
   * ============================================================ */
  var Practice = {
    mode: 'order',
    type: 'quiz', // quiz (做题) | recite (背题)
    title: '',
    list: [],
    idx: 0,
    isOrder: false,
    combo: 0,

    enter: function (cfg) {
      this.mode = cfg.mode;
      this.title = cfg.title;
      this.list = cfg.list;
      this.idx = cfg.idx || 0;
      this.isOrder = !!cfg.isOrder;
      this.type = 'quiz';
      this.combo = 0;

      this.updateModeTabs();
      $('p-title').innerText = this.title;
      Nav.goto('practice');
      this.render();
    },

    switchType: function (t) {
      if (this.type === t) return;
      this.type = t;
      this.updateModeTabs();
      this.render();
    },

    updateModeTabs: function () {
      var sw = $('practice-mode-switch');
      var q = $('tab-mode-quiz');
      var r = $('tab-mode-recite');
      if (!sw || !q || !r) return;

      if (this.type === 'recite') {
        sw.setAttribute('data-tab', 'recite');
        r.classList.add('active');
        q.classList.remove('active');
      } else {
        sw.setAttribute('data-tab', 'quiz');
        q.classList.add('active');
        r.classList.remove('active');
      }
    },

    cur: function () {
      return this.list[this.idx];
    },

    render: function () {
      var q = this.cur();
      if (!q) return;

      $('p-sub').innerText = (this.idx + 1) + ' / ' + this.list.length;
      $('p-prev').disabled = (this.idx === 0);
      $('p-next').innerText = (this.idx === this.list.length - 1 ? '完成' : '下一题');

      var isFav = Store.isFav(q.id);
      $('p-fav').innerText = isFav ? '★' : '☆';
      $('p-fav').style.color = isFav ? '#f59e0b' : '';

      var answered = Store.answered(q.id);
      var userPick = Store.data.rec[q.id];
      var isRecite = (this.type === 'recite');

      var html = '<div class="q-card">';
      html += '  <div class="q-meta">';
      html += '    <span class="q-tag ' + (q.type === 'judge' ? 'orange' : '') + '">' + (q.type === 'judge' ? '判断题' : '单选题') + '</span>';
      html += '    <span class="q-cat">' + esc(q.cat || '综合') + '</span>';
      html += '    <span class="q-id">#' + q.id + '</span>';
      html += '  </div>';

      // 智能题干括号渲染
      var stemHtml = formatStem(q.stem, q.opts, q.answer, userPick, isRecite, answered, false);
      html += '  <div class="stem">' + stemHtml + '</div>';

      // 选项
      html += '  <div class="opts">';
      var opts = q.opts || ['正确', '错误'];
      for (var i = 0; i < opts.length; i++) {
        var optLetter = LETTERS[i] || '';
        var cls = 'opt';
        var isChosen = (userPick === i);
        var isAns = (q.answer === i);

        if (isRecite) {
          if (isAns) cls += ' ans';
        } else if (answered) {
          if (isAns) cls += ' ans';
          if (isChosen && !isAns) cls += ' pick-err';
        }

        html += '    <button class="' + cls + '" onclick="Practice.pick(' + i + ', event)">';
        html += '      <span class="opt-k">' + optLetter + '</span>';
        html += '      <span class="opt-t">' + esc(opts[i]) + '</span>';
        html += '    </button>';
      }
      html += '  </div>';

      // 解析栏
      if (isRecite || answered) {
        var isOk = (userPick === q.answer);
        html += '  <div class="explain" style="display:block">';
        if (!isRecite) {
          html += '    <div style="font-weight:700;margin-bottom:4px;color:' + (isOk ? 'var(--ok)' : 'var(--err)') + '">';
          html += (isOk ? '✓ 回答正确' : '✕ 回答错误') + '</div>';
        }
        var correctLetter = LETTERS[q.answer] || '';
        var correctText = opts[q.answer] || '';
        html += '    <div><b>正确答案：</b>' + correctLetter + (correctText ? ' · ' + esc(correctText) : '') + '</div>';
        if (q.explain) {
          html += '    <div style="margin-top:6px;font-size:13px;color:var(--text-2);line-height:1.5"><b>解析：</b>' + esc(q.explain) + '</div>';
        }
        html += '  </div>';
      }

      html += '</div>';
      $('p-body').innerHTML = html;

      if (this.isOrder) {
        Store.saveOrderProgress(this.idx);
      }
    },

    pick: function (optIdx, ev) {
      if (this.type === 'recite') return;
      var q = this.cur();
      if (!q) return;

      var wasAnswered = Store.answered(q.id);
      Store.mark(q.id, optIdx);

      var isOk = (optIdx === q.answer);
      try {
        if (window.AndroidBridge && window.AndroidBridge.vibrate) {
          window.AndroidBridge.vibrate(isOk ? 'success' : 'error');
        } else if (navigator.vibrate) {
          navigator.vibrate(isOk ? 25 : [40, 50, 40]);
        }
      } catch (e) {}
      if (isOk) {
        this.combo++;
        if (this.combo >= 2) this.showCombo(this.combo);
        var cx = ev ? ev.clientX : window.innerWidth / 2;
        var cy = ev ? ev.clientY : window.innerHeight / 2;
        FX.burst(cx, cy);
      } else {
        this.combo = 0;
        this.hideCombo();
      }

      this.render();

      // 答对时若开启自动跳题且不是最后一题
      if (isOk && !wasAnswered && this.idx < this.list.length - 1) {
        var self = this;
        setTimeout(function () {
          self.step(1);
        }, 360);
      }
    },

    step: function (delta) {
      var next = this.idx + delta;
      if (next < 0) return;
      if (next >= this.list.length) {
        Toast.show('已完成当前练习列表！');
        return;
      }
      this.idx = next;
      this.render();
    },

    toggleFav: function () {
      var q = this.cur();
      if (!q) return;
      var on = Store.toggleFav(q.id);
      $('p-fav').innerText = on ? '★' : '☆';
      $('p-fav').style.color = on ? '#f59e0b' : '';
      Toast.show(on ? '已加入收藏' : '已取消收藏');
    },

    openCard: function () {
      Cards.open({
        list: this.list,
        curIdx: this.idx,
        onSelect: function (i) {
          Practice.idx = i;
          Practice.render();
        }
      });
    },

    showCombo: function (c) {
      var pill = $('combo-pill');
      if (!pill) return;
      $('combo-text').innerText = '连对 ' + c + ' 题';
      pill.classList.remove('hidden');
    },

    hideCombo: function () {
      var pill = $('combo-pill');
      if (pill) pill.classList.add('hidden');
    },

    exit: function () {
      Home.render();
      Nav.goto('home');
    }
  };

  /* ============================================================
   * 8. 答题卡抽屉 (Cards)
   * ============================================================ */
  var Cards = {
    cfg: null,

    open: function (cfg) {
      this.cfg = cfg;
      var grid = $('card-grid');
      var html = '';
      var list = cfg.list;

      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        var isCur = (i === cfg.curIdx);
        var cls = 'cq';
        if (isCur) cls += ' cur';

        var ans = Store.isCorrect(q.id);
        if (ans === true) cls += ' ok';
        else if (ans === false) cls += ' err';

        html += '<div class="' + cls + '" onclick="Cards.jump(' + i + ')">' + (i + 1) + '</div>';
      }

      grid.innerHTML = html;
      $('card-clear-btn').style.display = 'inline-block';
      $('card-mask').classList.add('on');
      $('card-drawer').classList.add('on');
    },

    close: function () {
      $('card-mask').classList.remove('on');
      $('card-drawer').classList.remove('on');
    },

    jump: function (i) {
      this.close();
      if (this.cfg && this.cfg.onSelect) this.cfg.onSelect(i);
    },

    clearCurrent: function () {
      Modal.show('清理作答记录', '确定清空当前题库的所有练习记录吗？（收藏夹与考试记录将保留）', function () {
        Store.clearOrderRecords();
        Cards.close();
        Practice.render();
        Toast.show('已清空当前题库作答记录');
      });
    }
  };

  /* ============================================================
   * 9. 模拟考试 (ExamSetup / Exam / Result)
   * ============================================================ */
  var ExamSetup = {
    paper: 'std',
    count: 30,
    scope: 'all',
    dur: 60,

    init: function () {
      var self = this;
      this.bindChips('set-paper', function (v) { self.paper = v; self.updatePreview(); });
      this.bindChips('set-count', function (v) { self.count = +v; self.updatePreview(); });
      this.bindChips('set-scope', function (v) { self.scope = v; self.updatePreview(); });
      this.bindChips('set-time', function (v) { self.dur = +v; self.updatePreview(); });
      this.updatePreview();
      this.renderHistory();
    },

    bindChips: function (id, cb) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function (e) {
        var t = e.target;
        if (t.classList.contains('chip')) {
          el.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
          t.classList.add('on');
          cb(t.getAttribute('data-v'));
        }
      });
    },

    updatePreview: function () {
      var total = (DB && DB.questions) ? DB.questions.length : 0;
      var cnt = Math.min(this.count, total);
      var html = '<div style="font-size:13.5px;line-height:1.6;color:var(--text)">';
      html += '<b>试卷预览：</b>' + (this.paper === 'std' ? '标准卷' : '自定义卷');
      html += ' · 共 <b>' + cnt + '</b> 题';
      html += ' · 时长 <b>' + this.dur + '</b> 分钟';
      html += ' · 满分 100 分（60分及格）';
      html += '</div>';
      $('paper-preview').innerHTML = html;
    },

    renderHistory: function () {
      var box = $('exam-history');
      if (!box) return;
      var list = Store.examList();
      if (!list.length) {
        box.innerHTML = '';
        return;
      }
      var html = '<div class="section-title">往期模考记录</div>';
      list.slice(0, 5).forEach(function (r) {
        var pass = (r.score >= 60);
        html += '<div class="card" style="margin-bottom:8px;padding:12px 14px">';
        html += '  <div style="display:flex;justify-content:space-between;align-items:center">';
        html += '    <span style="font-weight:700;font-size:16px;color:' + (pass ? 'var(--ok)' : 'var(--err)') + '">' + r.score + ' 分</span>';
        html += '    <span style="font-size:11.5px;color:var(--text-3)">' + r.date + '</span>';
        html += '  </div>';
        html += '  <div style="font-size:12px;color:var(--text-2);margin-top:4px">';
        html += '    耗时 ' + fmtDur(r.spent) + ' · 正确率 ' + r.rate + '% (' + r.ok + '/' + r.total + '题)';
        html += '  </div>';
        html += '</div>';
      });
      box.innerHTML = html;
    },

    start: function () {
      if (!DB || !DB.questions || DB.questions.length === 0) {
        Toast.show('当前题库无试题');
        return;
      }
      var pool = DB.questions.slice();
      if (this.scope === 'single') pool = pool.filter(function (q) { return q.type === 'single'; });
      else if (this.scope === 'judge') pool = pool.filter(function (q) { return q.type === 'judge'; });

      if (pool.length === 0) {
        Toast.show('所选范围内没有题目');
        return;
      }

      pool = shuffle(pool);
      var targetCount = Math.min(this.count, pool.length);
      var paperQuestions = pool.slice(0, targetCount);

      Exam.enter({
        kind: this.paper === 'std' ? '标准卷' : '自定义卷',
        questions: paperQuestions,
        durSec: this.dur * 60
      });
    }
  };

  var Exam = {
    kind: '',
    questions: [],
    idx: 0,
    answers: {},
    spentSec: 0,
    timer: null,
    totalSec: 0,

    enter: function (cfg) {
      this.kind = cfg.kind;
      this.questions = cfg.questions;
      this.idx = 0;
      this.answers = {};
      this.spentSec = 0;
      this.totalSec = cfg.durSec;

      $('e-kind').innerText = this.kind;
      Nav.goto('exam');
      this.startTimer();
      this.render();
    },

    startTimer: function () {
      clearInterval(this.timer);
      var remain = this.totalSec;
      var self = this;
      $('e-timer').innerText = fmtTime(remain);

      this.timer = setInterval(function () {
        self.spentSec++;
        remain = Math.max(0, self.totalSec - self.spentSec);
        $('e-timer').innerText = fmtTime(remain);
        if (remain <= 0) {
          clearInterval(self.timer);
          Toast.show('考试时间到，系统已自动交卷');
          self.finish();
        }
      }, 1000);
    },

    cur: function () {
      return this.questions[this.idx];
    },

    render: function () {
      var q = this.cur();
      if (!q) return;

      $('e-sub').innerText = (this.idx + 1) + ' / ' + this.questions.length;
      $('e-prev').disabled = (this.idx === 0);
      $('e-next').innerText = (this.idx === this.questions.length - 1 ? '最后一题' : '下一题');

      var userPick = this.answers[q.id];

      var html = '<div class="q-card">';
      html += '  <div class="q-meta">';
      html += '    <span class="q-tag ' + (q.type === 'judge' ? 'orange' : '') + '">' + (q.type === 'judge' ? '判断题' : '单选题') + '</span>';
      html += '    <span class="q-cat">' + esc(q.cat || '综合') + '</span>';
      html += '    <span class="q-id">#' + (this.idx + 1) + '</span>';
      html += '  </div>';

      // 考试状态填入
      var stemHtml = formatStem(q.stem, q.opts, null, userPick, false, false, true);
      html += '  <div class="stem">' + stemHtml + '</div>';

      html += '  <div class="opts">';
      var opts = q.opts || ['正确', '错误'];
      for (var i = 0; i < opts.length; i++) {
        var cls = 'opt' + (userPick === i ? ' picked' : '');
        html += '    <button class="' + cls + '" onclick="Exam.pick(' + i + ')">';
        html += '      <span class="opt-k">' + LETTERS[i] + '</span>';
        html += '      <span class="opt-t">' + esc(opts[i]) + '</span>';
        html += '    </button>';
      }
      html += '  </div>';
      html += '</div>';

      $('e-body').innerHTML = html;
    },

    pick: function (optIdx) {
      var q = this.cur();
      if (!q) return;
      this.answers[q.id] = optIdx;
      this.render();
    },

    step: function (delta) {
      var next = this.idx + delta;
      if (next >= 0 && next < this.questions.length) {
        this.idx = next;
        this.render();
      }
    },

    openCard: function () {
      var self = this;
      Cards.open({
        list: this.questions,
        curIdx: this.idx,
        onSelect: function (i) {
          self.idx = i;
          self.render();
        }
      });
    },

    confirmQuit: function () {
      var self = this;
      Modal.show('退出考试', '确认退出本次考试吗？本次答题成绩将不会被记录。', function () {
        clearInterval(self.timer);
        Nav.goto('exam-setup');
      });
    },

    confirmSubmit: function () {
      var self = this;
      var done = Object.keys(this.answers).length;
      var total = this.questions.length;
      var remain = total - done;

      var tip = remain > 0 ? ('您还有 ' + remain + ' 道题尚未作答，确定要提前交卷吗？') : '所有试题均已作答完毕，确认交卷评分吗？';
      Modal.show('交卷确认', tip, function () {
        clearInterval(self.timer);
        self.finish();
      });
    },

    finish: function () {
      clearInterval(this.timer);
      var ok = 0;
      var total = this.questions.length;
      var self = this;

      this.questions.forEach(function (q) {
        var userPick = self.answers[q.id];
        if (userPick === q.answer) {
          ok++;
        } else if (userPick !== undefined) {
          Store.addWrong(q.id);
        }
      });

      var score = total > 0 ? Math.round((ok / total) * 100) : 0;
      var record = {
        date: fmtDate(new Date()),
        kind: this.kind,
        score: score,
        ok: ok,
        total: total,
        spent: this.spentSec,
        rate: total > 0 ? Math.round((ok / total) * 100) : 0
      };

      Store.addExam(record);
      Result.show(record, this.questions, this.answers);
    }
  };

  var Result = {
    show: function (rec, questions, answers) {
      Nav.goto('result');
      var pass = (rec.score >= 60);

      if (pass) {
        FX.confetti(rec.score >= 85);
      }

      var html = '<div class="wrap" style="padding-top:24px;text-align:center">';
      html += '  <div class="result-badge" style="font-size:52px;margin-bottom:8px">' + (pass ? '🎉' : '💪') + '</div>';
      html += '  <h1 style="font-size:42px;font-weight:800;color:' + (pass ? 'var(--ok)' : 'var(--err)') + ';margin:0">' + rec.score + ' <span style="font-size:20px">分</span></h1>';
      html += '  <p style="color:var(--text-2);margin-top:6px;font-size:14px">' + (pass ? '恭喜您顺利通过本次模考！' : '很遗憾未达及格线，继续加油！') + '</p>';

      html += '  <div class="card" style="margin-top:20px;text-align:left">';
      html += '    <div class="setup-row"><span>答对题数</span><b>' + rec.ok + ' / ' + rec.total + ' 题</b></div>';
      html += '    <div class="setup-row"><span>正确率</span><b>' + rec.rate + '%</b></div>';
      html += '    <div class="setup-row"><span>考试用时</span><b>' + fmtDur(rec.spent) + '</b></div>';
      html += '  </div>';

      html += '  <div style="margin-top:24px;display:flex;flex-direction:column;gap:10px">';
      html += '    <button class="btn primary" style="height:48px;font-size:16px" onclick="Nav.goto(\'exam-setup\')">再次模拟考试</button>';
      html += '    <button class="btn" style="height:48px" onclick="Home.render(); Nav.goto(\'home\')">返回首页</button>';
      html += '  </div>';
      html += '</div>';

      $('r-body').innerHTML = html;
    }
  };

  /* ============================================================
   * 10. 错题本与收藏 (List)
   * ============================================================ */
  var List = {
    curMode: 'wrong', // wrong | fav
    ids: [],

    render: function (mode) {
      this.curMode = mode;
      var isWrong = (mode === 'wrong');
      $('l-title').innerText = isWrong ? '错题本' : '我的收藏';
      $('l-action').style.display = isWrong ? 'block' : 'none';

      this.ids = isWrong ? Store.wrongIds() : Store.favIds();
      var box = $('l-body');

      if (!this.ids.length) {
        box.innerHTML = '<div style="text-align:center;padding:50px 20px;color:var(--text-3);font-size:14px">' +
          (isWrong ? '暂无错题记录，保持优良掌握状态！' : '暂无收藏题目，遇到重难点可在刷题时点击 ☆ 收藏。') + '</div>';
        return;
      }

      var html = '<div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">共收录 ' + this.ids.length + ' 道题目：</div>';
      var self = this;

      this.ids.forEach(function (id) {
        var q = BY_ID[id];
        if (!q) return;

        html += '<div class="card" style="margin-bottom:10px;padding:14px 16px">';
        html += '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
        html += '    <span class="q-tag ' + (q.type === 'judge' ? 'orange' : '') + '">' + (q.type === 'judge' ? '判断' : '单选') + '</span>';
        html += '    <span class="q-cat">' + esc(q.cat || '综合') + '</span>';
        html += '  </div>';

        // 默认显示填入标准答案的题干
        var filledStem = formatStem(q.stem, q.opts, q.answer, null, true, true, false);
        html += '  <div style="font-size:14.5px;font-weight:600;line-height:1.5;margin-bottom:8px">' + filledStem + '</div>';

        if (q.opts) {
          html += '  <div style="font-size:12.5px;color:var(--text-2);line-height:1.6">';
          html += '    <b>正确答案：</b>' + LETTERS[q.answer] + ' · ' + esc(q.opts[q.answer]);
          html += '  </div>';
        }

        if (isWrong) {
          html += '  <div style="margin-top:8px;text-align:right">';
          html += '    <button class="btn sm" style="color:var(--ok)" onclick="List.removeWrongItem(' + q.id + ')">已攻克 (移出错题)</button>';
          html += '  </div>';
        }
        html += '</div>';
      });

      box.innerHTML = html;
    },

    removeWrongItem: function (qid) {
      Store.removeWrong(qid);
      this.render('wrong');
      Toast.show('已从错题本移出');
    },

    doAction: function () {
      if (this.curMode === 'wrong' && this.ids.length > 0) {
        var qs = this.ids.map(function (id) { return BY_ID[id]; }).filter(Boolean);
        Practice.enter({
          mode: 'wrong',
          title: '错题特训',
          list: qs,
          idx: 0,
          isOrder: false
        });
      }
    }
  };

  /* ============================================================
   * 11. 统计页面 (Stats)
   * ============================================================ */
  var Stats = {
    render: function () {
      var total = (DB && DB.questions) ? DB.questions.length : 0;
      var c = Store.counts();
      var pct = total ? Math.round((c.done / total) * 100) : 0;
      var rate = c.done ? Math.round((c.ok / c.done) * 100) : 0;

      var html = '<div class="card" style="margin-bottom:14px">';
      html += '  <h3 style="margin-top:0">总答题掌握度</h3>';
      html += '  <div class="setup-row"><span>总题数</span><b>' + total + ' 题</b></div>';
      html += '  <div class="setup-row"><span>已练习题数</span><b>' + c.done + ' 题 (' + pct + '%)</b></div>';
      html += '  <div class="setup-row"><span>正确总数</span><b>' + c.ok + ' 题</b></div>';
      html += '  <div class="setup-row"><span>综合正确率</span><b>' + rate + '%</b></div>';
      html += '</div>';

      var cats = (DB && DB.meta && DB.meta.cats) || [];
      html += '<div class="section-title">各科目掌握详情</div><div class="card" style="padding:6px 14px">';
      cats.forEach(function (cat) {
        var qs = (DB.questions || []).filter(function (q) { return q.cat === cat; });
        var done = qs.filter(function (q) { return Store.answered(q.id); }).length;
        var ok = qs.filter(function (q) { return Store.isCorrect(q.id); }).length;
        var catRate = done ? Math.round((ok / done) * 100) : 0;

        html += '<div style="padding:10px 0;border-bottom:1px solid var(--line)">';
        html += '  <div style="display:flex;justify-content:space-between;font-size:13.5px">';
        html += '    <b>' + esc(cat) + '</b>';
        html += '    <span>' + done + '/' + qs.length + ' 题 · 正确率 ' + (done ? catRate + '%' : '—') + '</span>';
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';

      $('s-body').innerHTML = html;
    }
  };

  /* ============================================================
   * 12. 外观主题系统 (Theme)
   * ============================================================ */
  var Theme = {
    mode: 'auto',

    init: function () {
      this.mode = localStorage.getItem('uquiz_theme') || 'auto';
      this.apply();
    },

    cycle: function () {
      if (this.mode === 'auto') this.mode = 'light';
      else if (this.mode === 'light') this.mode = 'dark';
      else this.mode = 'auto';
      localStorage.setItem('uquiz_theme', this.mode);
      this.apply();
      Toast.show('已切换主题：' + (this.mode === 'auto' ? '跟随系统' : (this.mode === 'dark' ? '深色模式' : '浅色模式')));
    },

    apply: function () {
      var root = document.documentElement;
      var icon = $('theme-icon');
      var label = $('theme-label');

      if (this.mode === 'dark') {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        if (icon) icon.innerText = '🌙';
        if (label) label.innerText = '深色';
      } else if (this.mode === 'light') {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
        if (icon) icon.innerText = '☀️';
        if (label) label.innerText = '浅色';
      } else {
        root.removeAttribute('data-theme');
        var isSysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', isSysDark);
        if (icon) icon.innerText = '🌓';
        if (label) label.innerText = '自动';
      }
    }
  };

  /* ============================================================
   * 13. 导航与弹窗 (Nav / Toast / Modal)
   * ============================================================ */
  var Nav = {
    history: ['home'],

    goto: function (id, replace) {
      if (!replace) this.history.push(id);
      document.querySelectorAll('.screen').forEach(function (s) {
        s.classList.remove('active');
      });
      document.querySelectorAll('.drawer').forEach(function (d) {
        d.classList.remove('open');
      });
      document.querySelectorAll('.drawer-mask').forEach(function (m) {
        m.classList.remove('show');
      });
      var target = $('screen-' + id);
      if (target) target.classList.add('active');

      if (id === 'wrong') List.render('wrong');
      else if (id === 'fav') List.render('fav');
      else if (id === 'stats') Stats.render();
      else if (id === 'home') Home.render();
      else if (id === 'import') ImportUI.switchTab('text');
    },

    back: function () {
      if (this.history.length > 1) {
        this.history.pop();
        var prev = this.history[this.history.length - 1];
        this.goto(prev, true);
        return true;
      }
      return false;
    }
  };

  var Toast = {
    timer: null,
    show: function (msg) {
      var el = $('toast');
      if (!el) return;
      el.innerText = msg;
      el.classList.add('show');
      clearTimeout(this.timer);
      this.timer = setTimeout(function () {
        el.classList.remove('show');
      }, 2000);
    }
  };

  var Modal = {
    cb: null,
    show: function (title, text, onOk) {
      this.cb = onOk;
      $('modal-title').innerText = title;
      $('modal-text').innerText = text;
      $('modal-mask').classList.add('on');
    },
    close: function () {
      $('modal-mask').classList.remove('on');
    }
  };

  /* ============================================================
   * 14. 启动引导 (Boot)
   * ============================================================ */
  function boot() {
    Theme.init();
    FX.init();
    BankManager.init();
    ImportUI.init();
    ExamSetup.init();

    $('modal-ok').addEventListener('click', function () {
      var cb = Modal.cb;
      Modal.close();
      if (cb) cb();
    });
    $('modal-cancel').addEventListener('click', function () { Modal.close(); });

    Home.render();
    Nav.goto('home', true);

    // 隐藏启动动画
    var l = $('loading');
    if (l) {
      l.classList.add('hide');
      setTimeout(function () { l.style.display = 'none'; }, 320);
    }
  }

  // 全局暴露供 HTML 绑定
  window.Home = Home;
  window.Practice = Practice;
  window.Exam = Exam;
  window.ExamSetup = ExamSetup;
  window.List = List;
  window.Stats = Stats;
  window.Result = Result;
  window.Cards = Cards;
  window.Toast = Toast;
  window.Nav = Nav;
  window.Store = Store;
  window.Theme = Theme;
  window.FX = FX;
  window.BankManager = BankManager;
  window.ImportUI = ImportUI;

  // Android 原生物理返回键监听支持
  window.__onBackPressed = function () {
    var modalMask = $('modal-mask');
    if (modalMask && modalMask.classList.contains('show')) {
      Modal.close();
      return true;
    }
    var cardDrawer = $('card-drawer');
    if (cardDrawer && cardDrawer.classList.contains('open')) {
      Cards.close();
      return true;
    }
    var bankDrawer = $('bank-drawer');
    if (bankDrawer && bankDrawer.classList.contains('open')) {
      BankManager.closeDrawer();
      return true;
    }
    var homeScreen = $('screen-home');
    if (homeScreen && !homeScreen.classList.contains('active')) {
      return Nav.back();
    }
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
