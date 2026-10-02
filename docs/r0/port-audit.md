# R0.6 — 文件级移植审计（port audit）

> 由 `tools/audit/port-audit.ps1` 自动生成。分类规则见脚本头部注释。
>
> 这是对 `docs/rewrite-plan.md` §2.1「按包估算」的细化 —— 落到**每个文件**，
> 以便真正能排期，也能验证那份估算。

## 1. 总量

| 项 | 数值 |
|---|---:|
| Java 文件 | 831 |
| 代码行 | 77825 |

## 2. 分类汇总

| 分类 | 文件 | 行数 | 占比（行） | 说明 |
|---|---:|---:|---:|---|
| `DROP` | 354 | 35274 | 45.3% | 被新栈取代，不移植（GUI / 主题 / VR / DSSL / Discord / 旧渲染 / 旧本地化） |
| `PORT-MODEL` | 207 | 8391 | 10.8% | NCPF 数据模型与配置模型，语义移植 |
| `PORT-FORMAT` | 53 | 8166 | 10.5% | 格式 IO（兼容性契约面） |
| `PORT-UI-LOGIC` | 153 | 7961 | 10.2% | 无 UI 依赖的业务逻辑（action / symmetry / editor 工具） |
| `SPLIT-PHYSICS-UI` | 9 | 7214 | 9.3% | ⚠️ 物理与渲染在同一个文件里 —— 必须先拆再移植 |
| `REWRITE` | 36 | 5745 | 7.4% | 需换机制重写（反射模块注册 / 设置 / 教程引擎 / i18n） |
| `REVIEW` | 16 | 2833 | 3.6% | 需人工判断 |
| `PORT-PHYSICS` | 3 | 2241 | 2.9% | 反应堆物理，必须合并为**唯一内核** |

### 与重写方案估算的对照

| 类别 | 本审计实测行数 | 重写方案估算 |
|---|---:|---:|
| 需要移植（PORT-* + 物理部分） | 33973 | 15,000–18,000 |
| 丢弃（DROP） | 35274 | ~35,000 |
| 需换机制重写或人工判断 | 8578 | — |

> 注意：`PORT-PHYSICS` 与 `SPLIT-PHYSICS-UI` 里仍然混着大量编辑器/提示代码，
> 实际需要移植的物理可能只有其中一半左右。真正的切割线要在 R1 里逐文件确定。

## 3. 需要立刻注意的文件（物理与渲染耦合）

共 **9** 个文件同时包含物理计算与渲染代码，共 7214 行。

| 行数 | 文件 |
|---:|---|
| 2117 | `net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/OverhaulMSR.java` |
| 1878 | `net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java` |
| 877 | `net/ncplanner/plannerator/multiblock/overhaul/turbine/OverhaulTurbine.java` |
| 661 | `net/ncplanner/plannerator/multiblock/underhaul/fissionsfr/UnderhaulSFR.java` |
| 442 | `net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/Block.java` |
| 407 | `net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/Block.java` |
| 362 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/CompiledOverhaulSFRConfiguration.java` |
| 309 | `net/ncplanner/plannerator/multiblock/overhaul/fusion/Block.java` |
| 161 | `net/ncplanner/plannerator/multiblock/underhaul/fissionsfr/Block.java` |

## 4. 逐文件清单

| 分类 | 行数 | 文件 |
|---|---:|---|
| `DROP` | 2070 | `net/ncplanner/plannerator/discord/Bot.java` |
| `DROP` | 1674 | `net/ncplanner/plannerator/graphics/Renderer.java` |
| `DROP` | 1302 | `net/ncplanner/plannerator/planner/gui/menu/MenuEdit.java` |
| `DROP` | 1244 | `net/ncplanner/plannerator/planner/localization/SimplifiedChineseLocalizer.java` |
| `DROP` | 830 | `net/ncplanner/plannerator/planner/theme/RandomColorsTheme.java` |
| `DROP` | 825 | `net/ncplanner/plannerator/planner/theme/SiezureTheme.java` |
| `DROP` | 770 | `net/ncplanner/plannerator/discord/play/smivilization/Hut.java` |
| `DROP` | 753 | `net/ncplanner/plannerator/planner/theme/legacy/LegacyTheme.java` |
| `DROP` | 712 | `net/ncplanner/plannerator/planner/theme/SmoreTheme.java` |
| `DROP` | 709 | `net/ncplanner/plannerator/planner/gui/menu/MenuGenerator.java` |
| `DROP` | 687 | `net/ncplanner/plannerator/planner/gui/menu/MenuMain.java` |
| `DROP` | 666 | `net/ncplanner/plannerator/planner/theme/ChangingTheme.java` |
| `DROP` | 649 | `net/ncplanner/plannerator/planner/theme/ChangingColorTheme.java` |
| `DROP` | 597 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuElementConfiguration.java` |
| `DROP` | 585 | `net/ncplanner/plannerator/planner/gui/menu/dssl/DsslEditor.java` |
| `DROP` | 577 | `net/ncplanner/plannerator/planner/vr/menu/VRMenuEdit.java` |
| `DROP` | 544 | `net/ncplanner/plannerator/planner/gui/menu/MenuCredits.java` |
| `DROP` | 467 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentEditorGrid.java` |
| `DROP` | 445 | `net/ncplanner/plannerator/planner/vr/VRCore.java` |
| `DROP` | 413 | `net/ncplanner/plannerator/planner/gui/menu/dssl/MenuDsslEditor.java` |
| `DROP` | 402 | `net/ncplanner/plannerator/planner/gui/menu/MenuTransition.java` |
| `DROP` | 396 | `net/ncplanner/plannerator/planner/theme/Theme.java` |
| `DROP` | 392 | `net/ncplanner/plannerator/planner/gui/menu/MenuInit.java` |
| `DROP` | 366 | `net/ncplanner/plannerator/discord/play/game/HeatsinkBattle.java` |
| `DROP` | 338 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentEditorGrid.java` |
| `DROP` | 314 | `net/ncplanner/plannerator/planner/gui/menu/component/Scrollable.java` |
| `DROP` | 278 | `net/ncplanner/plannerator/discord/play/game/Hangman.java` |
| `DROP` | 266 | `net/ncplanner/plannerator/planner/gui/menu/component/TextBox.java` |
| `DROP` | 260 | `net/ncplanner/plannerator/planner/dssl/Tokenizer.java` |
| `DROP` | 257 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuModifyElementDefinition.java` |
| `DROP` | 225 | `net/ncplanner/plannerator/planner/vr/menu/VRMenuResize.java` |
| `DROP` | 220 | `net/ncplanner/plannerator/planner/gui/menu/MenuResize.java` |
| `DROP` | 206 | `net/ncplanner/plannerator/graphics/legacyobj/model/loader/OBJLoader.java` |
| `DROP` | 204 | `net/ncplanner/plannerator/planner/gui/menu/component/DropdownList.java` |
| `DROP` | 203 | `net/ncplanner/plannerator/discord/play/smivilization/HutThing.java` |
| `DROP` | 202 | `net/ncplanner/plannerator/planner/gui/Component.java` |
| `DROP` | 199 | `net/ncplanner/plannerator/planner/gui/menu/MenuCalibrateCursor.java` |
| `DROP` | 191 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuConfiguration.java` |
| `DROP` | 188 | `net/ncplanner/plannerator/planner/gui/menu/MenuSettings.java` |
| `DROP` | 176 | `net/ncplanner/plannerator/discord/play/SmoreBot.java` |
| `DROP` | 176 | `net/ncplanner/plannerator/graphics/image/Color.java` |
| `DROP` | 155 | `net/ncplanner/plannerator/planner/gui/menu/MenuBenchmark.java` |
| `DROP` | 153 | `net/ncplanner/plannerator/planner/gui/menu/component/Slider.java` |
| `DROP` | 151 | `net/ncplanner/plannerator/graphics/Font.java` |
| `DROP` | 147 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuSpecificConfiguration.java` |
| `DROP` | 144 | `net/ncplanner/plannerator/planner/dssl/DSSLInterpreter.java` |
| `DROP` | 133 | `net/ncplanner/plannerator/planner/gui/menu/component/OptionButton.java` |
| `DROP` | 131 | `net/ncplanner/plannerator/graphics/image/Image.java` |
| `DROP` | 128 | `net/ncplanner/plannerator/planner/gui/GUI.java` |
| `DROP` | 123 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuDialog.java` |
| `DROP` | 121 | `net/ncplanner/plannerator/planner/gui/menu/MenuResizeFusion.java` |
| `DROP` | 118 | `net/ncplanner/plannerator/discord/play/smivilization/thing/special/GlowshroomGlowshroomGlowshroomPoster.java` |
| `DROP` | 118 | `net/ncplanner/plannerator/discord/play/model/OBJLoader.java` |
| `DROP` | 116 | `net/ncplanner/plannerator/planner/gui/menu/component/ToggleBox.java` |
| `DROP` | 116 | `net/ncplanner/plannerator/planner/gui/Menu.java` |
| `DROP` | 116 | `net/ncplanner/plannerator/planner/vr/menu/VRMenuResizeFusion.java` |
| `DROP` | 113 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickReference.java` |
| `DROP` | 112 | `net/ncplanner/plannerator/planner/theme/legacy/SolidColorTheme.java` |
| `DROP` | 110 | `net/ncplanner/plannerator/planner/dssl/DSSLLexerIterator.java` |
| `DROP` | 109 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuGenerateTexture.java` |
| `DROP` | 108 | `net/ncplanner/plannerator/discord/KeywordCommand.java` |
| `DROP` | 107 | `net/ncplanner/plannerator/planner/vr/VRMenuComponent.java` |
| `DROP` | 106 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentTurbineRotorGraph.java` |
| `DROP` | 106 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentMultiblock.java` |
| `DROP` | 105 | `net/ncplanner/plannerator/graphics/legacyobj/model/Model.java` |
| `DROP` | 104 | `net/ncplanner/plannerator/planner/gui/menu/component/Button.java` |
| `DROP` | 103 | `net/ncplanner/plannerator/graphics/model/Model.java` |
| `DROP` | 103 | `net/ncplanner/plannerator/planner/gui/menu/component/Label.java` |
| `DROP` | 102 | `net/ncplanner/plannerator/graphics/model/Mesh.java` |
| `DROP` | 101 | `net/ncplanner/plannerator/planner/vr/Multitool.java` |
| `DROP` | 99 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuSaveDialog.java` |
| `DROP` | 99 | `net/ncplanner/plannerator/discord/play/model/Material.java` |
| `DROP` | 99 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/BorderLayout.java` |
| `DROP` | 98 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuImport.java` |
| `DROP` | 97 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuPlacementRuleConfiguration.java` |
| `DROP` | 95 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/SplitLayout.java` |
| `DROP` | 90 | `net/ncplanner/plannerator/planner/gui/menu/dssl/ScrollableDsslEditor.java` |
| `DROP` | 89 | `net/ncplanner/plannerator/discord/play/smivilization/thing/TomPainting.java` |
| `DROP` | 88 | `net/ncplanner/plannerator/planner/dssl/DSSLProcessor.java` |
| `DROP` | 87 | `net/ncplanner/plannerator/planner/vr/menu/VRMenuMain.java` |
| `DROP` | 87 | `net/ncplanner/plannerator/planner/gui/menu/MenuImageExportPreview.java` |
| `DROP` | 87 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentButton.java` |
| `DROP` | 86 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuAddon.java` |
| `DROP` | 86 | `net/ncplanner/plannerator/planner/gui/menu/component/TextView.java` |
| `DROP` | 86 | `net/ncplanner/plannerator/planner/gui/menu/component/TextureButton.java` |
| `DROP` | 86 | `net/ncplanner/plannerator/graphics/FontCharacter.java` |
| `DROP` | 85 | `net/ncplanner/plannerator/planner/gui/menu/component/config2/C2ConfigEntryComponent.java` |
| `DROP` | 84 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentSuggestion.java` |
| `DROP` | 83 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentEditorListBlock.java` |
| `DROP` | 82 | `net/ncplanner/plannerator/planner/gui/menu/MenuMultiblockMetadata.java` |
| `DROP` | 82 | `net/ncplanner/plannerator/discord/keyword/KeywordBlockRange.java` |
| `DROP` | 79 | `net/ncplanner/plannerator/planner/gui/menu/MenuTutorial.java` |
| `DROP` | 79 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuLoadConfirm.java` |
| `DROP` | 78 | `net/ncplanner/plannerator/planner/vr/VRMenu.java` |
| `DROP` | 78 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuLoad.java` |
| `DROP` | 75 | `net/ncplanner/plannerator/discord/play/model/Model.java` |
| `DROP` | 74 | `net/ncplanner/plannerator/planner/gui/menu/configuration/NCPFElementComponent.java` |
| `DROP` | 74 | `net/ncplanner/plannerator/planner/gui/menu/component/MenuComponentModule.java` |
| `DROP` | 73 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuOverlaySettings.java` |
| `DROP` | 71 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentToolPanel.java` |
| `DROP` | 71 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentSpecialPanel.java` |
| `DROP` | 71 | `net/ncplanner/plannerator/planner/gui/menu/component/TextDisplay.java` |
| `DROP` | 70 | `net/ncplanner/plannerator/discord/play/smivilization/thing/LightSwitch.java` |
| `DROP` | 69 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Lamp.java` |
| `DROP` | 69 | `net/ncplanner/plannerator/discord/play/smivilization/thing/SpaceLamp.java` |
| `DROP` | 68 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuSymmetrySettings.java` |
| `DROP` | 68 | `net/ncplanner/plannerator/planner/gui/menu/configuration/ConfigurationMenu.java` |
| `DROP` | 68 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentSuggestor.java` |
| `DROP` | 67 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentElement.java` |
| `DROP` | 66 | `net/ncplanner/plannerator/graphics/Shader.java` |
| `DROP` | 66 | `net/ncplanner/plannerator/discord/play/smivilization/thing/special/SmoreTrophy.java` |
| `DROP` | 66 | `net/ncplanner/plannerator/discord/play/smivilization/thing/special/EatenSmoreTrophy.java` |
| `DROP` | 65 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentBlockRecipe.java` |
| `DROP` | 64 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentMultiblockRecipe.java` |
| `DROP` | 64 | `net/ncplanner/plannerator/planner/theme/ColorTheme.java` |
| `DROP` | 63 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Bed.java` |
| `DROP` | 63 | `net/ncplanner/plannerator/discord/play/smivilization/thing/SpaceBed.java` |
| `DROP` | 63 | `net/ncplanner/plannerator/discord/play/smivilization/thing/TropicalBed.java` |
| `DROP` | 62 | `net/ncplanner/plannerator/planner/gui/menu/MenuConfig2Editor.java` |
| `DROP` | 62 | `net/ncplanner/plannerator/planner/gui/menu/component/MulticolumnList.java` |
| `DROP` | 62 | `net/ncplanner/plannerator/discord/play/smivilization/thing/CoffeeTable.java` |
| `DROP` | 62 | `net/ncplanner/plannerator/discord/play/smivilization/thing/special/PatreonPoster.java` |
| `DROP` | 61 | `net/ncplanner/plannerator/discord/play/smivilization/thing/WastelandBed.java` |
| `DROP` | 61 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Table.java` |
| `DROP` | 61 | `net/ncplanner/plannerator/discord/play/smivilization/thing/SpaceTable.java` |
| `DROP` | 61 | `net/ncplanner/plannerator/discord/play/smivilization/thing/TropicalTable.java` |
| `DROP` | 61 | `net/ncplanner/plannerator/discord/play/smivilization/thing/WastelandTable.java` |
| `DROP` | 59 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentEditorTool.java` |
| `DROP` | 58 | `net/ncplanner/plannerator/discord/play/smivilization/thing/WastelandShelf.java` |
| `DROP` | 58 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentEditorListBlock.java` |
| `DROP` | 58 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Shelf.java` |
| `DROP` | 58 | `net/ncplanner/plannerator/discord/play/smivilization/thing/TropicalShelf.java` |
| `DROP` | 58 | `net/ncplanner/plannerator/discord/play/smivilization/thing/SpaceShelf.java` |
| `DROP` | 57 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentMultiblock.java` |
| `DROP` | 56 | `net/ncplanner/plannerator/discord/play/smivilization/thing/SmoreRug.java` |
| `DROP` | 56 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuMessageDialog.java` |
| `DROP` | 55 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickConfiguration.java` |
| `DROP` | 55 | `net/ncplanner/plannerator/planner/gui/menu/component/config2/C2ConfigComponentBase.java` |
| `DROP` | 54 | `net/ncplanner/plannerator/planner/gui/menu/component/BenchmarkComponent.java` |
| `DROP` | 54 | `net/ncplanner/plannerator/planner/gui/menu/component/SingleColumnList.java` |
| `DROP` | 54 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuInputDialog.java` |
| `DROP` | 54 | `net/ncplanner/plannerator/planner/gui/menu/component/ProgressBar.java` |
| `DROP` | 53 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Couch.java` |
| `DROP` | 52 | `net/ncplanner/plannerator/planner/dssl/token/Helpers.java` |
| `DROP` | 51 | `net/ncplanner/plannerator/discord/play/smivilization/thing/TelevisionRemote.java` |
| `DROP` | 51 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuError.java` |
| `DROP` | 51 | `net/ncplanner/plannerator/discord/play/smivilization/thing/Television.java` |
| `DROP` | 51 | `net/ncplanner/plannerator/planner/gui/menu/component/HorizontalList.java` |
| `DROP` | 51 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuComponentAddon.java` |
| `DROP` | 50 | `net/ncplanner/plannerator/discord/play/smivilization/PlacementPoint.java` |
| `DROP` | 50 | `net/ncplanner/plannerator/planner/vr/VRGUI.java` |
| `DROP` | 50 | `net/ncplanner/plannerator/discord/play/smivilization/thing/PurpleTriflorice.java` |
| `DROP` | 50 | `net/ncplanner/plannerator/discord/play/smivilization/thing/PuLaptop.java` |
| `DROP` | 49 | `net/ncplanner/plannerator/discord/keyword/KeywordFuel.java` |
| `DROP` | 48 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuCriticalError.java` |
| `DROP` | 48 | `net/ncplanner/plannerator/discord/play/Game.java` |
| `DROP` | 46 | `net/ncplanner/plannerator/planner/gui/menu/SettingsMenu.java` |
| `DROP` | 45 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuWarningMessage.java` |
| `DROP` | 44 | `net/ncplanner/plannerator/discord/keyword/KeywordMultiblock.java` |
| `DROP` | 44 | `net/ncplanner/plannerator/planner/theme/RainbowTheme.java` |
| `DROP` | 43 | `net/ncplanner/plannerator/discord/keyword/KeywordConfiguration.java` |
| `DROP` | 42 | `net/ncplanner/plannerator/planner/gui/menu/MenuThemes.java` |
| `DROP` | 42 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/legacy/LegacyExpandingGridLayout.java` |
| `DROP` | 41 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuReadFiles.java` |
| `DROP` | 41 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/legacy/LegacySingleColumnGridLayout.java` |
| `DROP` | 41 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuImportConfirm.java` |
| `DROP` | 40 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentEditorTool.java` |
| `DROP` | 40 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/LayeredLayout.java` |
| `DROP` | 39 | `net/ncplanner/plannerator/planner/gui/menu/component/ToggleButton.java` |
| `DROP` | 39 | `net/ncplanner/plannerator/discord/play/action/SmoreLordAction.java` |
| `DROP` | 39 | `net/ncplanner/plannerator/discord/keyword/KeywordCube.java` |
| `DROP` | 39 | `net/ncplanner/plannerator/planner/gui/menu/MenuModules.java` |
| `DROP` | 38 | `net/ncplanner/plannerator/discord/keyword/KeywordCuboid.java` |
| `DROP` | 38 | `net/ncplanner/plannerator/planner/gui/menu/configuration/MenuComponentInternalAddon.java` |
| `DROP` | 37 | `net/ncplanner/plannerator/discord/play/action/SnoozeAction.java` |
| `DROP` | 37 | `net/ncplanner/plannerator/discord/play/Action.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/ListLayout.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/discord/play/smivilization/HutBunch.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/planner/theme/FontStandardTheme.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickParameter.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuLoadFile.java` |
| `DROP` | 36 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentMultiblockSettingsPanel.java` |
| `DROP` | 35 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/SplitListLayout.java` |
| `DROP` | 35 | `net/ncplanner/plannerator/discord/play/smivilization/HutThingColorable.java` |
| `DROP` | 35 | `net/ncplanner/plannerator/planner/dssl/token/ArrayOrFieldAccessToken.java` |
| `DROP` | 35 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentVisibleBlock.java` |
| `DROP` | 34 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentTextPanel.java` |
| `DROP` | 34 | `net/ncplanner/plannerator/planner/gui/menu/component/Panel.java` |
| `DROP` | 34 | `net/ncplanner/plannerator/planner/gui/menu/dssl/EditorTabComponent.java` |
| `DROP` | 33 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/GridLayout.java` |
| `DROP` | 33 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickMutator.java` |
| `DROP` | 33 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickElementDefinition.java` |
| `DROP` | 33 | `net/ncplanner/plannerator/discord/play/action/SmoreAction.java` |
| `DROP` | 32 | `net/ncplanner/plannerator/planner/gui/menu/component/tutorial/MenuComponentTutorial.java` |
| `DROP` | 32 | `net/ncplanner/plannerator/planner/gui/menu/component/tutorial/MenuComponentTutorialCategory.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickGeneratorMutator.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/discord/keyword/KeywordSymmetry.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/discord/keyword/KeywordSmores.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/planner/gui/menu/configuration/NCPFPlacementRuleComponent.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/planner/gui/menu/component/tutorial/MenuComponentTutorialDisplay.java` |
| `DROP` | 31 | `net/ncplanner/plannerator/planner/gui/menu/dssl/EditorTab.java` |
| `DROP` | 30 | `net/ncplanner/plannerator/graphics/legacyobj/model/Face.java` |
| `DROP` | 30 | `net/ncplanner/plannerator/discord/play/model/Face.java` |
| `DROP` | 30 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/legacy/LegacyGridLayout.java` |
| `DROP` | 29 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickNCPF.java` |
| `DROP` | 29 | `net/ncplanner/plannerator/discord/keyword/KeywordBlind.java` |
| `DROP` | 29 | `net/ncplanner/plannerator/discord/keyword/KeywordFormat.java` |
| `DROP` | 29 | `net/ncplanner/plannerator/discord/keyword/KeywordPriority.java` |
| `DROP` | 29 | `net/ncplanner/plannerator/graphics/legacyobj/model/Material.java` |
| `DROP` | 28 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuUpdate.java` |
| `DROP` | 28 | `net/ncplanner/plannerator/planner/gui/menu/component/config2/C2ConfigListComponent.java` |
| `DROP` | 27 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickCondition.java` |
| `DROP` | 27 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuTaskDialog.java` |
| `DROP` | 27 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuSelect.java` |
| `DROP` | 27 | `net/ncplanner/plannerator/planner/dssl/token/Token.java` |
| `DROP` | 27 | `net/ncplanner/plannerator/planner/gui/menu/component/LayoutPanel.java` |
| `DROP` | 26 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuPickEnum.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/discord/play/smivilization/Placement.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuModifyElementStack.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/gui/menu/component/config2/C2ConfigComponent.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/gui/LayoutMenu.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/dssl/token/CharValueToken.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/dssl/token/StringValueToken.java` |
| `DROP` | 25 | `net/ncplanner/plannerator/planner/dssl/token/BlockStringValueToken.java` |
| `DROP` | 24 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuUnsavedChanges.java` |
| `DROP` | 24 | `net/ncplanner/plannerator/planner/gui/menu/component/DropdownPile.java` |
| `DROP` | 23 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuTask.java` |
| `DROP` | 23 | `net/ncplanner/plannerator/planner/gui/menu/component/ThemeButton.java` |
| `DROP` | 21 | `net/ncplanner/plannerator/planner/dssl/token/operator/Operator.java` |
| `DROP` | 21 | `net/ncplanner/plannerator/planner/gui/menu/MenuDiscord.java` |
| `DROP` | 21 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/InvertedListLayout.java` |
| `DROP` | 20 | `net/ncplanner/plannerator/planner/gui/menu/component/IconButton.java` |
| `DROP` | 20 | `net/ncplanner/plannerator/discord/play/smivilization/HutType.java` |
| `DROP` | 20 | `net/ncplanner/plannerator/discord/Command.java` |
| `DROP` | 19 | `net/ncplanner/plannerator/planner/gui/menu/FakeMenu.java` |
| `DROP` | 19 | `net/ncplanner/plannerator/discord/play/PlayBot.java` |
| `DROP` | 18 | `net/ncplanner/plannerator/discord/Keyword.java` |
| `DROP` | 17 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuSiezureTheme.java` |
| `DROP` | 17 | `net/ncplanner/plannerator/planner/vr/menu/component/VRMenuComponentMultiblockOutputPanel.java` |
| `DROP` | 16 | `net/ncplanner/plannerator/planner/dssl/token/ClassStaticMemberReferenceToken.java` |
| `DROP` | 16 | `net/ncplanner/plannerator/planner/dssl/token/ClassInstanceMemberReferenceToken.java` |
| `DROP` | 16 | `net/ncplanner/plannerator/planner/dssl/token/LabelToken.java` |
| `DROP` | 16 | `net/ncplanner/plannerator/planner/dssl/token/ModuleToken.java` |
| `DROP` | 16 | `net/ncplanner/plannerator/planner/dssl/token/FloatValueToken.java` |
| `DROP` | 15 | `net/ncplanner/plannerator/planner/dssl/token/keyword/Keyword.java` |
| `DROP` | 15 | `net/ncplanner/plannerator/planner/dssl/token/IntValueToken.java` |
| `DROP` | 15 | `net/ncplanner/plannerator/planner/gui/menu/component/editor/MenuComponentMultiblockProgressBar.java` |
| `DROP` | 15 | `net/ncplanner/plannerator/planner/dssl/StackUnderflowError.java` |
| `DROP` | 15 | `net/ncplanner/plannerator/planner/dssl/token/BoolValueToken.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/InterpretKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/IntKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/IsKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ListKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/LoopKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/MacroKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/BreakKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/MagicKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/NativeKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/NewKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/NotKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/NullKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/PopKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/IncludeKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ImportKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/IfKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/IfElseKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ForeachKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/FloatKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ExecKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ExchKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/DupKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/DictKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/DerefKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/DefKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/PrintKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ContinueKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ClassKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/CharKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/CastKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/BoolKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/PrintlnKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/PowerOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/RangeKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/MinusOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/MultiplyOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/NotEqualToOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/EqualToOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/DivideOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/gui/menu/component/config2/C2ConfigNumberListComponent.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/operator/PlusOperator.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/QuitKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/StringKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/StackSizeKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/SetKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/RollKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/RepeatKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/ReadKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/planner/dssl/token/keyword/TypeKeyword.java` |
| `DROP` | 14 | `net/ncplanner/plannerator/discord/SecretCommand.java` |
| `DROP` | 13 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/ListButtonsLayout.java` |
| `DROP` | 12 | `net/ncplanner/plannerator/planner/gui/menu/dialog/MenuOKMessageDialog.java` |
| `DROP` | 12 | `net/ncplanner/plannerator/planner/theme/StandardTheme.java` |
| `DROP` | 12 | `net/ncplanner/plannerator/discord/play/model/Line.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/planner/dssl/token/InvalidToken.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/discord/play/smivilization/HutThingExclusive.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/planner/dssl/token/BlankToken.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/graphics/legacyobj/model/Line.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/planner/dssl/token/CommentToken.java` |
| `DROP` | 11 | `net/ncplanner/plannerator/planner/dssl/token/IdentifierToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/XOrEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/RightShiftOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/RightShiftEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/LBracketToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/IncrementToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/RemainderOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/LBraceToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/XOrOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/RemainderEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/OrEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/RBracketToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/AndEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/AndOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/ConcatEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/ConcatOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/DivideEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/EqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/IDivideEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/IDivideOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/LeftShiftEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/LeftShiftOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/LessOrEqualOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/LessThanOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/MinusEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/ModuloEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/MoreOrEqualOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/MultiplyEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/OrOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/PlusEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/PowerEqualsOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/RBraceToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/ModuloOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/operator/MoreThanOperator.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/DecrementToken.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/graphics/model/Material.java` |
| `DROP` | 10 | `net/ncplanner/plannerator/planner/dssl/token/ESSLToken.java` |
| `DROP` | 9 | `net/ncplanner/plannerator/planner/gui/menu/component/layout/Layout.java` |
| `DROP` | 9 | `net/ncplanner/plannerator/planner/localization/Localization.java` |
| `DROP` | 8 | `net/ncplanner/plannerator/graphics/model/Vertex.java` |
| `DROP` | 8 | `net/ncplanner/plannerator/planner/theme/ThemeCategory.java` |
| `DROP` | 6 | `net/ncplanner/plannerator/graphics/legacyobj/model/loader/AdjacentFileProvider.java` |
| `DROP` | 6 | `net/ncplanner/plannerator/planner/dssl/token/operator/AbstractEqualsOperator.java` |
| `DROP` | 5 | `net/ncplanner/plannerator/planner/localization/TextLocalizer.java` |
| `DROP` | 4 | `net/ncplanner/plannerator/discord/play/game/StopReason.java` |
| `DROP` | 4 | `net/ncplanner/plannerator/discord/play/smivilization/Wall.java` |
| `PORT-FORMAT` | 1363 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF11Reader.java` |
| `PORT-FORMAT` | 830 | `net/ncplanner/plannerator/planner/file/writer/LegacyNCPFWriter.java` |
| `PORT-FORMAT` | 739 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF9Reader.java` |
| `PORT-FORMAT` | 552 | `net/ncplanner/plannerator/planner/file/JSON.java` |
| `PORT-FORMAT` | 420 | `net/ncplanner/plannerator/planner/file/reader/OverhaulNCConfigReader.java` |
| `PORT-FORMAT` | 377 | `net/ncplanner/plannerator/planner/file/ncpf/NCPFFileReader.java` |
| `PORT-FORMAT` | 257 | `net/ncplanner/plannerator/planner/file/writer/HellrageWriter.java` |
| `PORT-FORMAT` | 234 | `net/ncplanner/plannerator/planner/file/recovery/RecoveryModeHandler.java` |
| `PORT-FORMAT` | 171 | `net/ncplanner/plannerator/planner/file/writer/BGStringWriter.java` |
| `PORT-FORMAT` | 168 | `net/ncplanner/plannerator/planner/file/writer/PNGWriter.java` |
| `PORT-FORMAT` | 168 | `net/ncplanner/plannerator/planner/file/ForgeConfig.java` |
| `PORT-FORMAT` | 165 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR6Reader.java` |
| `PORT-FORMAT` | 164 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR6Reader.java` |
| `PORT-FORMAT` | 137 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR2Reader.java` |
| `PORT-FORMAT` | 137 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR2Reader.java` |
| `PORT-FORMAT` | 134 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR3Reader.java` |
| `PORT-FORMAT` | 133 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR3Reader.java` |
| `PORT-FORMAT` | 128 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR4Reader.java` |
| `PORT-FORMAT` | 127 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR4Reader.java` |
| `PORT-FORMAT` | 125 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF10Reader.java` |
| `PORT-FORMAT` | 123 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR5Reader.java` |
| `PORT-FORMAT` | 123 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF2Reader.java` |
| `PORT-FORMAT` | 122 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF4Reader.java` |
| `PORT-FORMAT` | 122 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR5Reader.java` |
| `PORT-FORMAT` | 119 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageMSR1Reader.java` |
| `PORT-FORMAT` | 119 | `net/ncplanner/plannerator/planner/file/reader/OverhaulHellrageSFR1Reader.java` |
| `PORT-FORMAT` | 102 | `net/ncplanner/plannerator/planner/file/reader/UnderhaulNCConfigReader.java` |
| `PORT-FORMAT` | 75 | `net/ncplanner/plannerator/planner/file/reader/LegacyNeutronSourceHandler.java` |
| `PORT-FORMAT` | 71 | `net/ncplanner/plannerator/planner/file/writer/NCPFWriter.java` |
| `PORT-FORMAT` | 53 | `net/ncplanner/plannerator/planner/file/reader/UnderhaulHellrage2Reader.java` |
| `PORT-FORMAT` | 52 | `net/ncplanner/plannerator/planner/file/reader/UnderhaulHellrage1Reader.java` |
| `PORT-FORMAT` | 47 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF7Reader.java` |
| `PORT-FORMAT` | 46 | `net/ncplanner/plannerator/planner/file/ImageFormatWriter.java` |
| `PORT-FORMAT` | 45 | `net/ncplanner/plannerator/planner/file/FileReader.java` |
| `PORT-FORMAT` | 43 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF1Reader.java` |
| `PORT-FORMAT` | 42 | `net/ncplanner/plannerator/planner/file/recovery/NonRecoveryHandler.java` |
| `PORT-FORMAT` | 38 | `net/ncplanner/plannerator/planner/file/FileWriter.java` |
| `PORT-FORMAT` | 35 | `net/ncplanner/plannerator/planner/file/ncpf/JSONNCPFWriter.java` |
| `PORT-FORMAT` | 33 | `net/ncplanner/plannerator/planner/file/ncpf/NCPFFileWriter.java` |
| `PORT-FORMAT` | 32 | `net/ncplanner/plannerator/planner/file/ncpf/JSONNCPFReader.java` |
| `PORT-FORMAT` | 30 | `net/ncplanner/plannerator/planner/file/StringFormatWriter.java` |
| `PORT-FORMAT` | 27 | `net/ncplanner/plannerator/planner/file/recovery/RecoveryHandler.java` |
| `PORT-FORMAT` | 18 | `net/ncplanner/plannerator/planner/file/FileFormat.java` |
| `PORT-FORMAT` | 18 | `net/ncplanner/plannerator/planner/file/reader/NCPFReader.java` |
| `PORT-FORMAT` | 16 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF8Reader.java` |
| `PORT-FORMAT` | 15 | `net/ncplanner/plannerator/planner/file/FormatWriter.java` |
| `PORT-FORMAT` | 15 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF6Reader.java` |
| `PORT-FORMAT` | 13 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF3Reader.java` |
| `PORT-FORMAT` | 12 | `net/ncplanner/plannerator/planner/file/reader/LegacyNCPF5Reader.java` |
| `PORT-FORMAT` | 10 | `net/ncplanner/plannerator/planner/file/FormatReader.java` |
| `PORT-FORMAT` | 8 | `net/ncplanner/plannerator/planner/file/ncpf/NCPFFormatWriter.java` |
| `PORT-FORMAT` | 7 | `net/ncplanner/plannerator/planner/file/ZenScript.java` |
| `PORT-FORMAT` | 6 | `net/ncplanner/plannerator/planner/file/ncpf/NCPFFormatReader.java` |
| `PORT-MODEL` | 293 | `net/ncplanner/plannerator/ncpf/io/NCPFObject.java` |
| `PORT-MODEL` | 292 | `net/ncplanner/plannerator/ncpf/NCPFPlacementRule.java` |
| `PORT-MODEL` | 279 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/OverhaulSFRConfigurationBuilder.java` |
| `PORT-MODEL` | 273 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/OverhaulMSRConfigurationBuilder.java` |
| `PORT-MODEL` | 234 | `net/ncplanner/plannerator/ncpf/element/NCPFSettingsElement.java` |
| `PORT-MODEL` | 205 | `net/ncplanner/plannerator/ncpf/NCPFConfigurationContainer.java` |
| `PORT-MODEL` | 200 | `net/ncplanner/plannerator/planner/ncpf/module/NCPFSettingsModule.java` |
| `PORT-MODEL` | 197 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/UnderhaulSFRConfigurationBuilder.java` |
| `PORT-MODEL` | 179 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/OverhaulTurbineConfigurationBuilder.java` |
| `PORT-MODEL` | 172 | `net/ncplanner/plannerator/ncpf/DefinedNCPFObject.java` |
| `PORT-MODEL` | 152 | `net/ncplanner/plannerator/ncpf/configuration/NCPFConfiguration.java` |
| `PORT-MODEL` | 110 | `net/ncplanner/plannerator/ncpf/DefinedNCPFModularObject.java` |
| `PORT-MODEL` | 107 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulFusion/BlockElement.java` |
| `PORT-MODEL` | 107 | `net/ncplanner/plannerator/ncpf/NCPFElement.java` |
| `PORT-MODEL` | 104 | `net/ncplanner/plannerator/planner/ncpf/Configuration.java` |
| `PORT-MODEL` | 103 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulFusionDesign.java` |
| `PORT-MODEL` | 99 | `net/ncplanner/plannerator/planner/ncpf/Project.java` |
| `PORT-MODEL` | 99 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/ConfigurationBuilder.java` |
| `PORT-MODEL` | 98 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulMSRDesign.java` |
| `PORT-MODEL` | 96 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulSFRDesign.java` |
| `PORT-MODEL` | 93 | `net/ncplanner/plannerator/planner/ncpf/configuration/builder/OverhaulDistillerConfigurationBuilder.java` |
| `PORT-MODEL` | 88 | `net/ncplanner/plannerator/planner/ncpf/design/UnderhaulSFRDesign.java` |
| `PORT-MODEL` | 84 | `net/ncplanner/plannerator/planner/ncpf/configuration/OverhaulFusionConfiguration.java` |
| `PORT-MODEL` | 78 | `net/ncplanner/plannerator/ncpf/NCPFModuleContainer.java` |
| `PORT-MODEL` | 77 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulDistillerDesign.java` |
| `PORT-MODEL` | 66 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulTurbineDesign.java` |
| `PORT-MODEL` | 64 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulSFR/BlockElement.java` |
| `PORT-MODEL` | 63 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulMSR/BlockElement.java` |
| `PORT-MODEL` | 58 | `net/ncplanner/plannerator/planner/ncpf/configuration/BlockRecipesElement.java` |
| `PORT-MODEL` | 55 | `net/ncplanner/plannerator/planner/ncpf/defined/field/ElementListPlanneratorField.java` |
| `PORT-MODEL` | 54 | `net/ncplanner/plannerator/planner/ncpf/defined/DefinedPlanneratorRecipe.java` |
| `PORT-MODEL` | 50 | `net/ncplanner/plannerator/ncpf/element/NCPFLegacyBlockElement.java` |
| `PORT-MODEL` | 50 | `net/ncplanner/plannerator/ncpf/NCPFElementReference.java` |
| `PORT-MODEL` | 49 | `net/ncplanner/plannerator/ncpf/io/NCPFList.java` |
| `PORT-MODEL` | 47 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/CoolantVentModule.java` |
| `PORT-MODEL` | 47 | `net/ncplanner/plannerator/ncpf/element/NCPFModuleElement.java` |
| `PORT-MODEL` | 47 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/ReservoirPortModule.java` |
| `PORT-MODEL` | 44 | `net/ncplanner/plannerator/ncpf/NCPFElementStack.java` |
| `PORT-MODEL` | 43 | `net/ncplanner/plannerator/ncpf/element/NCPFLegacyItemElement.java` |
| `PORT-MODEL` | 43 | `net/ncplanner/plannerator/planner/ncpf/module/MetadataModule.java` |
| `PORT-MODEL` | 42 | `net/ncplanner/plannerator/planner/ncpf/Addon.java` |
| `PORT-MODEL` | 41 | `net/ncplanner/plannerator/planner/ncpf/Design.java` |
| `PORT-MODEL` | 40 | `net/ncplanner/plannerator/ncpf/element/NCPFElementDefinition.java` |
| `PORT-MODEL` | 40 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulDistiller/BlockElement.java` |
| `PORT-MODEL` | 40 | `net/ncplanner/plannerator/ncpf/NCPFFile.java` |
| `PORT-MODEL` | 40 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulTurbine/BlockElement.java` |
| `PORT-MODEL` | 39 | `net/ncplanner/plannerator/planner/ncpf/defined/DefinedPlanneratorModule.java` |
| `PORT-MODEL` | 38 | `net/ncplanner/plannerator/ncpf/element/NCPFLegacyRecipeElement.java` |
| `PORT-MODEL` | 37 | `net/ncplanner/plannerator/ncpf/defined/field/ElementListNCPFField.java` |
| `PORT-MODEL` | 37 | `net/ncplanner/plannerator/planner/ncpf/module/BlockRulesModule.java` |
| `PORT-MODEL` | 36 | `net/ncplanner/plannerator/ncpf/design/NCPFUnderhaulSFRDesign.java` |
| `PORT-MODEL` | 36 | `net/ncplanner/plannerator/ncpf/configuration/UnknownNCPFConfiguration.java` |
| `PORT-MODEL` | 36 | `net/ncplanner/plannerator/ncpf/design/NCPFOverhaulSFRDesign.java` |
| `PORT-MODEL` | 36 | `net/ncplanner/plannerator/ncpf/element/NCPFBlockElement.java` |
| `PORT-MODEL` | 34 | `net/ncplanner/plannerator/ncpf/design/NCPFOverhaulMSRDesign.java` |
| `PORT-MODEL` | 34 | `net/ncplanner/plannerator/ncpf/element/NCPFListElement.java` |
| `PORT-MODEL` | 33 | `net/ncplanner/plannerator/ncpf/element/NCPFStackListElement.java` |
| `PORT-MODEL` | 32 | `net/ncplanner/plannerator/planner/ncpf/configuration/underhaulSFR/BlockElement.java` |
| `PORT-MODEL` | 32 | `net/ncplanner/plannerator/ncpf/design/NCPFOverhaulDistillerDesign.java` |
| `PORT-MODEL` | 32 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/OverhaulFusionSettingsModule.java` |
| `PORT-MODEL` | 32 | `net/ncplanner/plannerator/ncpf/element/NCPFBlockTagElement.java` |
| `PORT-MODEL` | 32 | `net/ncplanner/plannerator/ncpf/design/NCPFOverhaulTurbineDesign.java` |
| `PORT-MODEL` | 31 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/NeutronShieldModule.java` |
| `PORT-MODEL` | 31 | `net/ncplanner/plannerator/planner/ncpf/module/GlobalElementsModule.java` |
| `PORT-MODEL` | 31 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/NeutronShieldModule.java` |
| `PORT-MODEL` | 30 | `net/ncplanner/plannerator/planner/ncpf/configuration/BlockReference.java` |
| `PORT-MODEL` | 30 | `net/ncplanner/plannerator/planner/ncpf/module/TextureModule.java` |
| `PORT-MODEL` | 30 | `net/ncplanner/plannerator/ncpf/module/NCPFBlockRecipesModule.java` |
| `PORT-MODEL` | 30 | `net/ncplanner/plannerator/ncpf/element/UnknownNCPFElement.java` |
| `PORT-MODEL` | 29 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/BreedingBlanketModule.java` |
| `PORT-MODEL` | 29 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/ActiveCoolerModule.java` |
| `PORT-MODEL` | 29 | `net/ncplanner/plannerator/ncpf/element/NCPFItemElement.java` |
| `PORT-MODEL` | 29 | `net/ncplanner/plannerator/ncpf/element/NCPFItemTagElement.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulDistiller/DistillerRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulFusion/BreedingBlanketRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulSFR/IrradiatorRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/underhaulSFR/Fuel.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulSFR/Fuel.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulFusion/CoolantRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulSFR/CoolantRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulMSR/IrradiatorRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulMSR/HeaterRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/underhaulSFR/ActiveCoolerRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulTurbine/TurbineRecipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulMSR/Fuel.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/planner/ncpf/configuration/overhaulFusion/Recipe.java` |
| `PORT-MODEL` | 28 | `net/ncplanner/plannerator/ncpf/NCPFModuleReference.java` |
| `PORT-MODEL` | 27 | `net/ncplanner/plannerator/ncpf/NCPFDesign.java` |
| `PORT-MODEL` | 27 | `net/ncplanner/plannerator/planner/ncpf/module/DisplayNameModule.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/defined/field/DefinedPlanneratorField.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/OverhaulTurbineSettingsModule.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/configuration/UnderhaulSFRConfiguration.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/configuration/OverhaulDistillerConfiguration.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/ConfigurationMetadataModule.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/configuration/OverhaulSFRConfiguration.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/planner/ncpf/module/GeneratorSettingsModule.java` |
| `PORT-MODEL` | 26 | `net/ncplanner/plannerator/ncpf/DefinedNCPFModularConfigurationContainer.java` |
| `PORT-MODEL` | 25 | `net/ncplanner/plannerator/planner/ncpf/configuration/NamedTexturedNCPFElement.java` |
| `PORT-MODEL` | 25 | `net/ncplanner/plannerator/ncpf/design/UnknownNCPFDesign.java` |
| `PORT-MODEL` | 25 | `net/ncplanner/plannerator/planner/ncpf/module/NuclearCraftGeneratedModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/PortModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/FuelStatsModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/FuelStatsModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/PortModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/ncpf/module/UnknownNCPFModule.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/ncpf/element/NCPFFluidElement.java` |
| `PORT-MODEL` | 24 | `net/ncplanner/plannerator/ncpf/element/NCPFLegacyFluidElement.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/ncpf/element/NCPFOredictElement.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/planner/ncpf/configuration/OverhaulMSRConfiguration.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/ncpf/element/NCPFRecipeElement.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/ncpf/element/NCPFFluidTagElement.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/ncpf/design/NCPFCuboidalMultiblockDesign.java` |
| `PORT-MODEL` | 23 | `net/ncplanner/plannerator/planner/ncpf/configuration/OverhaulTurbineConfiguration.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/IrradiatorModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/HeaterModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/ncpf/design/NCPFDesignDefinition.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/OverhaulSFRSettingsModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/UnderhaulSFRSettingsModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/FuelVesselModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/RecipeStatsModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/OverhaulMSRSettingsModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/FuelCellModule.java` |
| `PORT-MODEL` | 22 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/IrradiatorModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/TagsModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/ToroidalElectromagnetModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/CasingModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/OutletModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/ControllerModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/PoloidalElectromagnetModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/FuelCellModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/InletModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/ControllerModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/HeatingBlanketModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/CoreModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/ncpf/NCPFElementReferenceStack.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/ShaftModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/NCPFRecipePortsModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/ModeratorModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/ncpf/defined/field/DefinedNCPFField.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/LegacyNamesModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/ConnectorModule.java` |
| `PORT-MODEL` | 21 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/ConductorModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/AirModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/FuelStatsModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/CasingModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/CasingModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/CasingModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/CasingModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/BreedingBlanketStatsModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/RecipePortsModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/underhaulSFR/CoolerModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/HeatsinkModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/RecipePortsModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/CoilModule.java` |
| `PORT-MODEL` | 20 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/HeatsinkModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/BladeModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/BearingModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/ReflectorModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/ModeratorModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/ReflectorModule.java` |
| `PORT-MODEL` | 19 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/ModeratorModule.java` |
| `PORT-MODEL` | 18 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/IrradiatorStatsModule.java` |
| `PORT-MODEL` | 18 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/IrradiatorStatsModule.java` |
| `PORT-MODEL` | 18 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/RecipeStatsModule.java` |
| `PORT-MODEL` | 18 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/RecipeStatsModule.java` |
| `PORT-MODEL` | 18 | `net/ncplanner/plannerator/planner/ncpf/module/configuration/settings/OverhaulDistillerSettingsModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/ncpf/configuration/NCPFOverhaulDistillerConfiguration.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/ShieldingModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/StatorModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/ncpf/configuration/NCPFOverhaulSFRConfiguration.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/ncpf/configuration/NCPFOverhaulTurbineConfiguration.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/ncpf/configuration/NCPFUnderhaulSFRConfiguration.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/NeutronSourceModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/ncpf/module/NCPFModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/design/MultiblockDesign.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/design/OverhaulFusionDefinition.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/NeutronSourceModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/BlockFunctionModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/ReflectorModule.java` |
| `PORT-MODEL` | 17 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/SieveAssemblyModule.java` |
| `PORT-MODEL` | 16 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/ProcessPortModule.java` |
| `PORT-MODEL` | 16 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/CoolantRecipeStatsModule.java` |
| `PORT-MODEL` | 16 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/HeaterStatsModule.java` |
| `PORT-MODEL` | 16 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulFusion/CoolantRecipeStatsModule.java` |
| `PORT-MODEL` | 15 | `net/ncplanner/plannerator/ncpf/configuration/NCPFOverhaulMSRConfiguration.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/ControllerModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulTurbine/ConnectorModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/LiquidDistributerModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/PowerPortModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/ConductorModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/ConductorModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulMSR/ControllerModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/ReboilingUnitModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/RefluxUnitModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulSFR/ControllerModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/module/overhaulDistiller/SieveTrayModule.java` |
| `PORT-MODEL` | 14 | `net/ncplanner/plannerator/planner/ncpf/configuration/LegacyRecipeElement.java` |
| `PORT-MODEL` | 10 | `net/ncplanner/plannerator/planner/ncpf/design/UnknownDesign.java` |
| `PORT-MODEL` | 9 | `net/ncplanner/plannerator/ncpf/ConglomerationError.java` |
| `PORT-MODEL` | 8 | `net/ncplanner/plannerator/planner/ncpf/module/NCPFStatsModule.java` |
| `PORT-MODEL` | 7 | `net/ncplanner/plannerator/ncpf/RegisteredNCPFObject.java` |
| `PORT-MODEL` | 7 | `net/ncplanner/plannerator/planner/ncpf/annotation/RegisterWith.java` |
| `PORT-MODEL` | 6 | `net/ncplanner/plannerator/planner/ncpf/module/RecipesBlockModule.java` |
| `PORT-MODEL` | 4 | `net/ncplanner/plannerator/planner/ncpf/module/ElementStatsModule.java` |
| `PORT-MODEL` | 4 | `net/ncplanner/plannerator/planner/ncpf/configuration/MultiblockRecipeElement.java` |
| `PORT-MODEL` | 4 | `net/ncplanner/plannerator/planner/ncpf/module/ElementModule.java` |
| `PORT-MODEL` | 2 | `net/ncplanner/plannerator/ncpf/NCPFAddon.java` |
| `PORT-PHYSICS` | 982 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/LiteOverhaulSFR.java` |
| `PORT-PHYSICS` | 841 | `net/ncplanner/plannerator/multiblock/overhaul/fusion/OverhaulFusionReactor.java` |
| `PORT-PHYSICS` | 418 | `net/ncplanner/plannerator/multiblock/generator/lite/underhaulSFR/LiteUnderhaulSFR.java` |
| `PORT-UI-LOGIC` | 473 | `net/ncplanner/plannerator/multiblock/tinkers/TinkerTool.java` |
| `PORT-UI-LOGIC` | 262 | `net/ncplanner/plannerator/multiblock/CuboidalMultiblock.java` |
| `PORT-UI-LOGIC` | 212 | `net/ncplanner/plannerator/multiblock/overhaul/distiller/OverhaulDistiller.java` |
| `PORT-UI-LOGIC` | 207 | `net/ncplanner/plannerator/planner/editor/tool/PencilTool.java` |
| `PORT-UI-LOGIC` | 189 | `net/ncplanner/plannerator/multiblock/generator/lite/LiteGenerator.java` |
| `PORT-UI-LOGIC` | 187 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/mutators/random/RandomCellMutator.java` |
| `PORT-UI-LOGIC` | 169 | `net/ncplanner/plannerator/planner/editor/tool/SelectionTool.java` |
| `PORT-UI-LOGIC` | 158 | `net/ncplanner/plannerator/multiblock/tinkers/PartMaterial.java` |
| `PORT-UI-LOGIC` | 150 | `net/ncplanner/plannerator/planner/editor/tool/MoveTool.java` |
| `PORT-UI-LOGIC` | 141 | `net/ncplanner/plannerator/multiblock/generator/lite/CompiledPlacementRule.java` |
| `PORT-UI-LOGIC` | 140 | `net/ncplanner/plannerator/planner/editor/tool/RectangleTool.java` |
| `PORT-UI-LOGIC` | 126 | `net/ncplanner/plannerator/planner/editor/tool/LineTool.java` |
| `PORT-UI-LOGIC` | 103 | `net/ncplanner/plannerator/planner/editor/tool/PasteTool.java` |
| `PORT-UI-LOGIC` | 96 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/mutators/random/RandomBlockMutator.java` |
| `PORT-UI-LOGIC` | 96 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingIndicies.java` |
| `PORT-UI-LOGIC` | 95 | `net/ncplanner/plannerator/multiblock/configuration/TextureManager.java` |
| `PORT-UI-LOGIC` | 94 | `net/ncplanner/plannerator/planner/editor/tool/CopyTool.java` |
| `PORT-UI-LOGIC` | 93 | `net/ncplanner/plannerator/multiblock/generator/lite/underhaulSFR/mutators/random/RandomBlockMutator.java` |
| `PORT-UI-LOGIC` | 91 | `net/ncplanner/plannerator/planner/editor/tool/CutTool.java` |
| `PORT-UI-LOGIC` | 90 | `net/ncplanner/plannerator/multiblock/editor/action/MoveAction.java` |
| `PORT-UI-LOGIC` | 87 | `net/ncplanner/plannerator/multiblock/generator/lite/mutator/GeneratorMutator.java` |
| `PORT-UI-LOGIC` | 84 | `net/ncplanner/plannerator/multiblock/generator/lite/GeneratorStage.java` |
| `PORT-UI-LOGIC` | 82 | `net/ncplanner/plannerator/planner/editor/tool/EditorTool.java` |
| `PORT-UI-LOGIC` | 82 | `net/ncplanner/plannerator/multiblock/editor/action/CopyAction.java` |
| `PORT-UI-LOGIC` | 80 | `net/ncplanner/plannerator/planner/editor/suggestion/Suggestor.java` |
| `PORT-UI-LOGIC` | 80 | `net/ncplanner/plannerator/multiblock/symmetry/StandardSymmetry.java` |
| `PORT-UI-LOGIC` | 76 | `net/ncplanner/plannerator/multiblock/BoundingBox.java` |
| `PORT-UI-LOGIC` | 76 | `net/ncplanner/plannerator/multiblock/generator/lite/StageTransition.java` |
| `PORT-UI-LOGIC` | 74 | `net/ncplanner/plannerator/planner/editor/suggestion/Suggestion.java` |
| `PORT-UI-LOGIC` | 72 | `net/ncplanner/plannerator/multiblock/editor/decal/OverhaulModeratorLineDecal.java` |
| `PORT-UI-LOGIC` | 72 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingBoolean.java` |
| `PORT-UI-LOGIC` | 68 | `net/ncplanner/plannerator/multiblock/editor/symmetry/CoilSymmetry.java` |
| `PORT-UI-LOGIC` | 66 | `net/ncplanner/plannerator/multiblock/generator/lite/Priority.java` |
| `PORT-UI-LOGIC` | 66 | `net/ncplanner/plannerator/multiblock/BlockPos.java` |
| `PORT-UI-LOGIC` | 65 | `net/ncplanner/plannerator/multiblock/generator/lite/Symmetry.java` |
| `PORT-UI-LOGIC` | 65 | `net/ncplanner/plannerator/multiblock/editor/symmetry/AxialSymmetry.java` |
| `PORT-UI-LOGIC` | 64 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionAnd.java` |
| `PORT-UI-LOGIC` | 62 | `net/ncplanner/plannerator/multiblock/editor/action/SetblocksAction.java` |
| `PORT-UI-LOGIC` | 61 | `net/ncplanner/plannerator/multiblock/generator/Priority.java` |
| `PORT-UI-LOGIC` | 60 | `net/ncplanner/plannerator/multiblock/generator/lite/mutator/Mutator.java` |
| `PORT-UI-LOGIC` | 60 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionOr.java` |
| `PORT-UI-LOGIC` | 58 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/Condition.java` |
| `PORT-UI-LOGIC` | 56 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/BiFloatOperator.java` |
| `PORT-UI-LOGIC` | 54 | `net/ncplanner/plannerator/multiblock/Axis.java` |
| `PORT-UI-LOGIC` | 53 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionNot.java` |
| `PORT-UI-LOGIC` | 53 | `net/ncplanner/plannerator/multiblock/editor/decal/AdjacentModeratorLineDecal.java` |
| `PORT-UI-LOGIC` | 52 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorFloor.java` |
| `PORT-UI-LOGIC` | 52 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingFloat.java` |
| `PORT-UI-LOGIC` | 52 | `net/ncplanner/plannerator/multiblock/editor/action/PasteAction.java` |
| `PORT-UI-LOGIC` | 52 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingPercent.java` |
| `PORT-UI-LOGIC` | 52 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingInt.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/generator/lite/underhaulSFR/mutators/random/RandomFuelMutator.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/NeutronSourceTargetDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/AdjacentModeratorDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/NeutronSourceDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/ModeratorActiveDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/ReflectorAdjacentModeratorLineDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/IrradiatorAdjacentModeratorLineDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/decal/AdjacentCellDecal.java` |
| `PORT-UI-LOGIC` | 51 | `net/ncplanner/plannerator/multiblock/editor/action/SetBladeAction.java` |
| `PORT-UI-LOGIC` | 50 | `net/ncplanner/plannerator/multiblock/generator/lite/underhaulSFR/mutators/ClearInvalidMutator.java` |
| `PORT-UI-LOGIC` | 50 | `net/ncplanner/plannerator/multiblock/BlockGrid.java` |
| `PORT-UI-LOGIC` | 50 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/mutators/ClearInvalidMutator.java` |
| `PORT-UI-LOGIC` | 48 | `net/ncplanner/plannerator/planner/editor/Editor.java` |
| `PORT-UI-LOGIC` | 47 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/mutators/random/RandomCoolantRecipeMutator.java` |
| `PORT-UI-LOGIC` | 45 | `net/ncplanner/plannerator/planner/editor/overlay/EditorOverlay.java` |
| `PORT-UI-LOGIC` | 45 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/constant/ConstInt.java` |
| `PORT-UI-LOGIC` | 45 | `net/ncplanner/plannerator/multiblock/generator/lite/mutator/RandomQuantityMutator.java` |
| `PORT-UI-LOGIC` | 45 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/constant/ConstFloat.java` |
| `PORT-UI-LOGIC` | 43 | `net/ncplanner/plannerator/multiblock/editor/action/SFRSourceAction.java` |
| `PORT-UI-LOGIC` | 43 | `net/ncplanner/plannerator/multiblock/editor/action/MSRSourceAction.java` |
| `PORT-UI-LOGIC` | 42 | `net/ncplanner/plannerator/multiblock/SimpleMultiblock.java` |
| `PORT-UI-LOGIC` | 42 | `net/ncplanner/plannerator/multiblock/Direction.java` |
| `PORT-UI-LOGIC` | 42 | `net/ncplanner/plannerator/multiblock/editor/action/SetSelectionAction.java` |
| `PORT-UI-LOGIC` | 42 | `net/ncplanner/plannerator/multiblock/tinkers/PartType.java` |
| `PORT-UI-LOGIC` | 42 | `net/ncplanner/plannerator/multiblock/generator/lite/anim/LayerSplitAnimation.java` |
| `PORT-UI-LOGIC` | 41 | `net/ncplanner/plannerator/multiblock/tinkers/ToolType.java` |
| `PORT-UI-LOGIC` | 41 | `net/ncplanner/plannerator/multiblock/editor/Action.java` |
| `PORT-UI-LOGIC` | 39 | `net/ncplanner/plannerator/multiblock/editor/decal/NeutronSourceLineDecal.java` |
| `PORT-UI-LOGIC` | 39 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/BiCondition.java` |
| `PORT-UI-LOGIC` | 38 | `net/ncplanner/plannerator/multiblock/generator/lite/LiteMultiblock.java` |
| `PORT-UI-LOGIC` | 38 | `net/ncplanner/plannerator/multiblock/editor/action/SetblockAction.java` |
| `PORT-UI-LOGIC` | 37 | `net/ncplanner/plannerator/multiblock/editor/action/DeselectAction.java` |
| `PORT-UI-LOGIC` | 37 | `net/ncplanner/plannerator/multiblock/editor/action/SelectAction.java` |
| `PORT-UI-LOGIC` | 36 | `net/ncplanner/plannerator/multiblock/editor/decal/UnderhaulModeratorLineDecal.java` |
| `PORT-UI-LOGIC` | 34 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingString.java` |
| `PORT-UI-LOGIC` | 34 | `net/ncplanner/plannerator/multiblock/editor/action/SFRAllShieldsAction.java` |
| `PORT-UI-LOGIC` | 34 | `net/ncplanner/plannerator/multiblock/editor/action/MSRAllShieldsAction.java` |
| `PORT-UI-LOGIC` | 33 | `net/ncplanner/plannerator/multiblock/editor/action/SymmetryAction.java` |
| `PORT-UI-LOGIC` | 33 | `net/ncplanner/plannerator/multiblock/editor/action/GenerateAction.java` |
| `PORT-UI-LOGIC` | 32 | `net/ncplanner/plannerator/multiblock/generator/lite/mutator/SingleMutator.java` |
| `PORT-UI-LOGIC` | 32 | `net/ncplanner/plannerator/multiblock/editor/action/ClearSelectionAction.java` |
| `PORT-UI-LOGIC` | 31 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/constant/ConstRandom.java` |
| `PORT-UI-LOGIC` | 31 | `net/ncplanner/plannerator/multiblock/editor/decal/CellFluxDecal.java` |
| `PORT-UI-LOGIC` | 31 | `net/ncplanner/plannerator/multiblock/tinkers/ToolPart.java` |
| `PORT-UI-LOGIC` | 30 | `net/ncplanner/plannerator/multiblock/editor/ActionResult.java` |
| `PORT-UI-LOGIC` | 30 | `net/ncplanner/plannerator/multiblock/editor/action/SetMultiblockRecipeAction.java` |
| `PORT-UI-LOGIC` | 29 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingConditionList.java` |
| `PORT-UI-LOGIC` | 27 | `net/ncplanner/plannerator/multiblock/editor/EditorSpace.java` |
| `PORT-UI-LOGIC` | 25 | `net/ncplanner/plannerator/multiblock/editor/action/MSRToggleAction.java` |
| `PORT-UI-LOGIC` | 25 | `net/ncplanner/plannerator/multiblock/editor/action/SFRToggleAction.java` |
| `PORT-UI-LOGIC` | 24 | `net/ncplanner/plannerator/multiblock/editor/decal/BlockInvalidDecal.java` |
| `PORT-UI-LOGIC` | 24 | `net/ncplanner/plannerator/multiblock/editor/decal/BlockValidDecal.java` |
| `PORT-UI-LOGIC` | 24 | `net/ncplanner/plannerator/multiblock/editor/decal/MissingBladeDecal.java` |
| `PORT-UI-LOGIC` | 24 | `net/ncplanner/plannerator/multiblock/editor/decal/MissingCasingDecal.java` |
| `PORT-UI-LOGIC` | 24 | `net/ncplanner/plannerator/multiblock/editor/decal/NeutronSourceNoTargetDecal.java` |
| `PORT-UI-LOGIC` | 23 | `net/ncplanner/plannerator/multiblock/PartCount.java` |
| `PORT-UI-LOGIC` | 23 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingSymmetry.java` |
| `PORT-UI-LOGIC` | 21 | `net/ncplanner/plannerator/multiblock/Edge.java` |
| `PORT-UI-LOGIC` | 20 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionEqual.java` |
| `PORT-UI-LOGIC` | 20 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionNotEqual.java` |
| `PORT-UI-LOGIC` | 19 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionLess.java` |
| `PORT-UI-LOGIC` | 19 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionLessEqual.java` |
| `PORT-UI-LOGIC` | 19 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionGreaterEqual.java` |
| `PORT-UI-LOGIC` | 19 | `net/ncplanner/plannerator/multiblock/generator/lite/condition/ConditionGreater.java` |
| `PORT-UI-LOGIC` | 17 | `net/ncplanner/plannerator/multiblock/generator/lite/GenerationThread.java` |
| `PORT-UI-LOGIC` | 17 | `net/ncplanner/plannerator/multiblock/editor/symmetry/Symmetry.java` |
| `PORT-UI-LOGIC` | 17 | `net/ncplanner/plannerator/planner/editor/suggestion/SuggestorTask.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableBoolean.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableLong.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/symmetry/EditorSymmetry.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableInt.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableString.java` |
| `PORT-UI-LOGIC` | 16 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableFloat.java` |
| `PORT-UI-LOGIC` | 15 | `net/ncplanner/plannerator/multiblock/Vertex.java` |
| `PORT-UI-LOGIC` | 14 | `net/ncplanner/plannerator/multiblock/generator/lite/anim/BlankAnimation.java` |
| `PORT-UI-LOGIC` | 14 | `net/ncplanner/plannerator/multiblock/Range.java` |
| `PORT-UI-LOGIC` | 14 | `net/ncplanner/plannerator/multiblock/generator/lite/anim/SpinAnimation.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorMultiplication.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorMinimum.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorMaximum.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorDivision.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorAddition.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/constant/Constant.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/OperatorSubtraction.java` |
| `PORT-UI-LOGIC` | 13 | `net/ncplanner/plannerator/multiblock/generator/lite/anim/Animation.java` |
| `PORT-UI-LOGIC` | 12 | `net/ncplanner/plannerator/multiblock/editor/Decal.java` |
| `PORT-UI-LOGIC` | 12 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/Parameter.java` |
| `PORT-UI-LOGIC` | 11 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableNull.java` |
| `PORT-UI-LOGIC` | 11 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/operator/Operator.java` |
| `PORT-UI-LOGIC` | 11 | `net/ncplanner/plannerator/planner/editor/ClipboardEntry.java` |
| `PORT-UI-LOGIC` | 10 | `net/ncplanner/plannerator/multiblock/symmetry/Symmetry.java` |
| `PORT-UI-LOGIC` | 9 | `net/ncplanner/plannerator/multiblock/tinkers/MiningLevel.java` |
| `PORT-UI-LOGIC` | 8 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/Setting.java` |
| `PORT-UI-LOGIC` | 7 | `net/ncplanner/plannerator/multiblock/generator/lite/ThingWithSettings.java` |
| `PORT-UI-LOGIC` | 6 | `net/ncplanner/plannerator/multiblock/generator/lite/ThingWithVariables.java` |
| `PORT-UI-LOGIC` | 5 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/Variable.java` |
| `PORT-UI-LOGIC` | 5 | `net/ncplanner/plannerator/multiblock/configuration/ThingWithLegacyNames.java` |
| `PORT-UI-LOGIC` | 5 | `net/ncplanner/plannerator/multiblock/generator/lite/Expandable.java` |
| `PORT-UI-LOGIC` | 4 | `net/ncplanner/plannerator/multiblock/configuration/IBlockRecipe.java` |
| `PORT-UI-LOGIC` | 4 | `net/ncplanner/plannerator/multiblock/tinkers/PartCategory.java` |
| `PORT-UI-LOGIC` | 3 | `net/ncplanner/plannerator/multiblock/generator/lite/CompiledConfiguration.java` |
| `PORT-UI-LOGIC` | 2 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/VariableNumber.java` |
| `REVIEW` | 883 | `net/ncplanner/plannerator/planner/Core.java` |
| `REVIEW` | 545 | `net/ncplanner/plannerator/planner/Main.java` |
| `REVIEW` | 245 | `net/ncplanner/plannerator/planner/Updater.java` |
| `REVIEW` | 220 | `net/ncplanner/plannerator/planner/MathUtil.java` |
| `REVIEW` | 193 | `net/ncplanner/plannerator/planner/VersionManager.java` |
| `REVIEW` | 158 | `net/ncplanner/plannerator/planner/Queue.java` |
| `REVIEW` | 130 | `net/ncplanner/plannerator/planner/FormattedText.java` |
| `REVIEW` | 105 | `net/ncplanner/plannerator/planner/CircularStream.java` |
| `REVIEW` | 86 | `net/ncplanner/plannerator/planner/Searchable.java` |
| `REVIEW` | 76 | `net/ncplanner/plannerator/planner/ImageIO.java` |
| `REVIEW` | 58 | `net/ncplanner/plannerator/planner/Task.java` |
| `REVIEW` | 52 | `net/ncplanner/plannerator/planner/Pinnable.java` |
| `REVIEW` | 36 | `net/ncplanner/plannerator/planner/DebugInfoProvider.java` |
| `REVIEW` | 34 | `net/ncplanner/plannerator/planner/StringUtil.java` |
| `REVIEW` | 6 | `net/ncplanner/plannerator/planner/FileChooserResultListener.java` |
| `REVIEW` | 6 | `net/ncplanner/plannerator/planner/exception/MissingConfigurationEntryException.java` |
| `REWRITE` | 817 | `net/ncplanner/plannerator/multiblock/Multiblock.java` |
| `REWRITE` | 659 | `net/ncplanner/plannerator/planner/tutorial/NCPTTutorial.java` |
| `REWRITE` | 486 | `net/ncplanner/plannerator/planner/module/OverhaulModule.java` |
| `REWRITE` | 482 | `net/ncplanner/plannerator/config2/Config.java` |
| `REWRITE` | 427 | `net/ncplanner/plannerator/multiblock/AbstractBlock.java` |
| `REWRITE` | 365 | `net/ncplanner/plannerator/planner/module/RainbowFactorModule.java` |
| `REWRITE` | 343 | `net/ncplanner/plannerator/config2/ConfigList.java` |
| `REWRITE` | 303 | `net/ncplanner/plannerator/config2/ConfigNumberList.java` |
| `REWRITE` | 236 | `net/ncplanner/plannerator/multiblock/generator/lite/underhaulSFR/CompiledUnderhaulSFRConfiguration.java` |
| `REWRITE` | 231 | `net/ncplanner/plannerator/planner/module/Module.java` |
| `REWRITE` | 152 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingVariable.java` |
| `REWRITE` | 133 | `net/ncplanner/plannerator/planner/tutorial/TutorialFileReader.java` |
| `REWRITE` | 128 | `net/ncplanner/plannerator/planner/module/FusionTestModule.java` |
| `REWRITE` | 125 | `net/ncplanner/plannerator/multiblock/overhaul/distiller/Block.java` |
| `REWRITE` | 123 | `net/ncplanner/plannerator/multiblock/overhaul/turbine/Block.java` |
| `REWRITE` | 78 | `net/ncplanner/plannerator/multiblock/SimpleBlock.java` |
| `REWRITE` | 74 | `net/ncplanner/plannerator/planner/module/UnderhaulModule.java` |
| `REWRITE` | 68 | `net/ncplanner/plannerator/config2/ConfigBase.java` |
| `REWRITE` | 55 | `net/ncplanner/plannerator/planner/module/PrimeFuelModule.java` |
| `REWRITE` | 53 | `net/ncplanner/plannerator/multiblock/generator/lite/variable/setting/SettingCondition.java` |
| `REWRITE` | 40 | `net/ncplanner/plannerator/planner/module/CoreModule.java` |
| `REWRITE` | 39 | `net/ncplanner/plannerator/planner/tutorial/UpdatingTutorial.java` |
| `REWRITE` | 37 | `net/ncplanner/plannerator/planner/tutorial/Tutorial.java` |
| `REWRITE` | 36 | `net/ncplanner/plannerator/planner/module/QuantumTraversedEfficiencyModule.java` |
| `REWRITE` | 28 | `net/ncplanner/plannerator/config2/ConfigString.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigBoolean.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigByte.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigDouble.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigFloat.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigInteger.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigLong.java` |
| `REWRITE` | 25 | `net/ncplanner/plannerator/config2/ConfigShort.java` |
| `REWRITE` | 20 | `net/ncplanner/plannerator/planner/module/InternalModule.java` |
| `REWRITE` | 14 | `net/ncplanner/plannerator/planner/module/TiConModule.java` |
| `REWRITE` | 12 | `net/ncplanner/plannerator/planner/tutorial/TutorialCategory.java` |
| `REWRITE` | 6 | `net/ncplanner/plannerator/planner/tutorial/TutorialFormatReader.java` |
| `SPLIT-PHYSICS-UI` | 2117 | `net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/OverhaulMSR.java` |
| `SPLIT-PHYSICS-UI` | 1878 | `net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java` |
| `SPLIT-PHYSICS-UI` | 877 | `net/ncplanner/plannerator/multiblock/overhaul/turbine/OverhaulTurbine.java` |
| `SPLIT-PHYSICS-UI` | 661 | `net/ncplanner/plannerator/multiblock/underhaul/fissionsfr/UnderhaulSFR.java` |
| `SPLIT-PHYSICS-UI` | 442 | `net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/Block.java` |
| `SPLIT-PHYSICS-UI` | 407 | `net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/Block.java` |
| `SPLIT-PHYSICS-UI` | 362 | `net/ncplanner/plannerator/multiblock/generator/lite/overhaulSFR/CompiledOverhaulSFRConfiguration.java` |
| `SPLIT-PHYSICS-UI` | 309 | `net/ncplanner/plannerator/multiblock/overhaul/fusion/Block.java` |
| `SPLIT-PHYSICS-UI` | 161 | `net/ncplanner/plannerator/multiblock/underhaul/fissionsfr/Block.java` |

---

# R1.0d file-level update（逐文件复核，追加，不改动上文）

> 本节由 R1.0d 追加。**上文（R0.6 由 `tools/audit/port-audit.ps1` 生成的内容）保持原样不动**，
> 作为「包级规则分类」的基线留档。本节的分类与行数由 `tools/ts/port-audit.mjs` 机械生成，
> 完整报告见 `docs/r1/port-audit-file-level.md`，数据见 `docs/r1/port-audit-file-level.json`。

复现：

```bash
node tools/ts/port-audit.mjs --summary
node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json
node tools/ts/port-audit.mjs --report
```

`contentSha256 = 7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4`（2026-10 刷新；旧值
`e6b2f520…` 是 R0 时点的快照。该哈希现在是 CI 门禁：`tools/ts/port-audit.mjs` 内置 `EXPECTED_SHA`，
`--summary` / `--report` 哈希不符即 `exit 1`；实测值一律以 `docs/r1/port-audit-file-level.json` 的
`contentSha256` 为准。）

## A. 为什么要做这一步

上文（R0.6）的分类是**包级规则**：bucket 由目录前缀决定，只有 `multiblock/` 内部才叠加了一点内容启发式
（见 `tools/audit/port-audit.ps1` 的 `Classify`）。这带来两个问题：

1. **口径问题**：上面的「需要移植 33,973 行」= `PORT-MODEL + PORT-FORMAT + PORT-UI-LOGIC + PORT-PHYSICS + SPLIT-PHYSICS-UI`，
   把 `REWRITE`（5,745 行）与 `REVIEW`（2,833 行）**排除在工作量之外**——但它们同样必须被实现。
2. **精度问题**：内容启发式只作用于 `multiblock/`，且渲染正则里含 `getTexture`（纹理访问器），导致误判。

## B. 实测结果（与上文同指标可比的对照）

| 项 | 上文（包级规则） | R1.0d（逐文件） |
|---|---:|---:|
| 文件数 | 831 | 831 |
| 行数（同一指标） | 77,825 | 77,840（逐文件比对 829 / 831 一致，2 处不一致：中文化冻结提交 `4fad557f` 使 `OverhaulMSR.java` +9、`OverhaulSFR.java` +6） |
| 「必须实现」行数 | 33,973 | **38,560（+4,587，+13.5%）** |
| 「必须实现」文件数 | 425（PORT-* + SPLIT） | **431**（`PORT` 310 + `REWRITE` 115 + `VERIFY` 6） |
| 非空非注释行（R1.0d 口径） | — | 76,579（其中必须实现 38,026） |
| R1 范围内的必须实现 | — | **280 文件 / 25,822 raw / 25,365 code** |
| `DROP` | 354 文件 / 35,274 行 | 400 文件 / 39,280 行（多丢 config2 / tutorial / render decal / overlay / TextureManager / 桌面更新器 / PNG 写出） |

R1.0d 的 bucket：`PORT`（可 1:1 翻译）、`DROP`（不移植）、`REWRITE`（必须存在但机制不同：反射注册、120 个手写模块类、两套重复模拟器）、
`VERIFY`（必须重新推导、不能直译：6 个已知坏语义/恢复策略文件）。

## C. 对上文两处结论的修正

1. **§3「9 文件 / 7,214 行物理与渲染同居」不准确。** 逐文件数渲染调用后：
   只有 **4 个 `Block.java`（1,319 行）**真的有 `Renderer`/`draw*` 调用；
   另外 **5 文件 / 5,910 行**（`OverhaulMSR`、`OverhaulSFR`、`OverhaulTurbine`、`UnderhaulSFR`、
   `CompiledOverhaulSFRConfiguration`）只是命中了 `getTexture(...)`——那是元素纹理访问器。
   → 「没有安全切口」对那 4 个大反应堆不成立，它们物理与渲染**并未同居**；真正要先拆的是 4 个 `Block.java`。
2. **§1/§2 的「需要移植」口径偏低。** 上文把 `REWRITE`（5,745 行）与 `REVIEW`（2,833 行）排除在「需要移植」之外，
   但其中 **5,643 行**在 R1.0d 里属于必须实现（`REWRITE→PORT` 1,527 + `REWRITE→REWRITE` 1,933 + `REVIEW→PORT` 2,183；
   其中 2,177 行来自 `planner/` 根：`Core.java` 883、`Main.java` 545、`MathUtil.java` 220…）。
   同时 R1.0d 把 1,071 行（`PORT-UI-LOGIC→DROP` 857 + `PORT-FORMAT→DROP` 214）从必须实现里剔除。
   净差 = 5,643 − 1,071 + 15（中文化冻结提交带来的树漂移）= **+4,587 行**，这就是「实测比上文高 4,587 行」的完整来源。

## D. 修正后的 R1 工期

- 方案 §4.1–4.7 的子任务预算之和 = 34.5–54 人日 = **6.9–10.8 周**，与标题「R1 — 5–7 周」已经矛盾；
- 逐文件实测 R1 范围必须实现 25,365 非空非注释行；在 5–7 周内（扣掉 R1.0–R1.2 的 9–14 人日后只剩 11–26 人日）
  需要 **976–2,306 行/天**，是方案自己给物理/格式工作流隐含速率（264–743 行/天）的 1.3–8.7 倍；
- **结论：R1 的 5–7 周不成立，建议改为 8–10 周**（逐项：R1.0 4d + R1.1 2.5d + R1.2 5d + R1.3 9d + R1.4 4d + R1.5 10d + R1.6 10d = 44.5 人日 ≈ 8.9 周）。
  若按 §5.4 砍掉 Fusion / Distiller，可回到约 7 周。M1 闸门不变。

