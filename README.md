# 云岫 · 体素山水

一个以 Three.js 实现的实时 3D 体素自然景观。场景由程序生成的群山、两条分段瀑布、山腰云海、山脚针叶林与晨雾构成，页面打开后会自动巡游，无需操作即可看到全貌。

## 环境要求

- Node.js `>= 22.13.0`
- 支持 WebGL 2 的现代浏览器（Chrome、Edge、Firefox 等）

## 安装与启动

```powershell
cd E:\Aclaw文件\voxel-mountain-waterfall
npm install
npm run dev
```

随后打开终端显示的本地地址，默认是 <http://localhost:3000/>。

## 构建与生产预览

```powershell
npm run build
npm run start
```

## 验证

```powershell
npm test
```

`npm test` 会重新构建项目，并检查服务端输出、场景关键实现、Three.js 依赖和社交预览图。

## 操作

- 页面会自动缓慢环绕群山。
- 按住鼠标拖拽可自由环视。
- 滚轮可调整观察距离。
- 左下角按钮可暂停或恢复自动巡游。

## 实现说明

- 山体通过多峰高程函数、分形噪声与沟谷切割生成，保留主峰、次峰和自然峰谷。
- 地形、树木、水块与云块均使用 `InstancedMesh` 批量绘制，避免逐体素产生大量 draw call。
- 两条水路会沿高程单向下降，在断崖处自动展开为竖直体素水幕，并配有流光粒子、水潭和水雾。
- 云块与柔雾分布在山体前后，启用深度测试以形成山峰穿云的遮挡关系。
- 渲染分辨率上限和动态降档机制用于维持稳定帧率；页面右上角显示实时 FPS、体素数与绘制次数。

核心场景代码位于 `app/VoxelLandscape.tsx`，页面界面位于 `app/page.tsx`，视觉样式位于 `app/globals.css`。
