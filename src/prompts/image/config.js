// 生图模板配置
// 用户可选风格 → 追加到扩写 prompt 的 style 定向，影响最终出图

module.exports = {
  styles: {
    cinematic: '电影感',
    photorealistic: '摄影写实',
    illustration: '插画',
    minimal: '极简',
    editorial: '杂志海报',
    product: '产品图',
  },
  defaultStyle: 'photorealistic',
  width: 1200,
  height: 800,
};