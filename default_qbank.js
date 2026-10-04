/**
 * 通用智能刷题器 · 默认示范题库 (纯净独立版)
 * 不内置数控车工题库，仅保留通用示范试题供开箱体验
 */
(function (global) {
  'use strict';

  var demoQuestions = [
    {
      id: 1,
      type: 'single',
      stem: '道德是通过（ ）对一个人的品行发生极大的作用。',
      opts: ['社会舆论', '国家强制执行', '个人的影响', '国家政策'],
      answer: 0,
      cat: '职业素养',
      explain: '道德主要依靠社会舆论、传统习俗和内心信念来维系。'
    },
    {
      id: 2,
      type: 'single',
      stem: '计算机中用于临时存储正在运行的程序和数据的部件是（ ）。',
      opts: ['随机存取存储器（RAM）', '只读存储器（ROM）', '固态硬盘（SSD）', '运算器'],
      answer: 0,
      cat: '计算机技术',
      explain: 'RAM 俗称运行内存，读写速度极快但断电后易失。'
    },
    {
      id: 3,
      type: 'single',
      stem: '在太阳系中，体积和质量最大的行星是（ ）。',
      opts: ['火星', '木星', '土星', '金星'],
      answer: 1,
      cat: '自然科学',
      explain: '木星是太阳系八大行星之王，体积是地球的 1300 倍。'
    },
    {
      id: 4,
      type: 'single',
      stem: '中华人民共和国国家标准的代号是（ ）。',
      opts: ['JB', 'QB', 'TB', 'GB'],
      answer: 3,
      cat: '标准规范',
      explain: 'GB 为国家标准（Guobiao）的拼音缩写。'
    },
    {
      id: 5,
      type: 'judge',
      stem: 'Python 是一种解释型高级编程语言。（ ）',
      opts: ['正确', '错误'],
      answer: 0,
      cat: '编程技术',
      explain: 'Python 由解释器逐行翻译执行字节码，具备跨平台特性。'
    },
    {
      id: 6,
      type: 'judge',
      stem: '光在真空中的传播速度小于声音在空气中的传播速度。',
      opts: ['正确', '错误'],
      answer: 1,
      cat: '自然科学',
      explain: '光速约 30 万公里/秒，远超常温常压下的空气声速（约 340 米/秒）。'
    },
    {
      id: 7,
      type: 'judge',
      stem: '计算机操作系统中，Linux 内核是完全闭源且商业收费的。',
      opts: ['正确', '错误'],
      answer: 1,
      cat: '计算机技术',
      explain: 'Linux 内核是遵循开源协议的自由操作系统内核。'
    }
  ];

  var demoBank = {
    meta: {
      name: '通用常识与计算机基础 (示范题库)',
      desc: '示范题库 · 涵盖单选题、判断题与详细解析',
      total: 7,
      single: 4,
      judge: 3,
      cats: ['职业素养', '计算机技术', '自然科学', '标准规范', '编程技术']
    },
    questions: demoQuestions
  };

  global.BUILTIN_BANKS = [
    {
      id: 'bank_general_demo',
      name: '通用常识与计算机基础 (示范题库)',
      desc: '开箱即用示范题库 · 涵盖单选、判断与解析',
      icon: '💻',
      isBuiltin: true,
      data: demoBank
    }
  ];

})(typeof window !== 'undefined' ? window : global);
