#!/usr/bin/env python3
"""Regenerate the checked-in Xcode project without third-party build dependencies."""
from pathlib import Path
import hashlib, json
root=Path(__file__).parent
objects={}
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
def add(name,body): objects[uid(name)]=body; return uid(name)
def arr(items): return '( '+', '.join(items)+' )'
files=sorted((root/'Journey').glob('*.swift'))
refs=[]; builds=[]
for p in files:
 r=add(str(p.name),f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {p.name}; sourceTree = "<group>";')
 refs.append(r); builds.append(add('build'+p.name,f'isa = PBXBuildFile; fileRef = {r};'))
plist=add('plist','isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
asset=add('asset','isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";')
assetbuild=add('assetbuild',f'isa = PBXBuildFile; fileRef = {asset};')
product=add('product','isa = PBXFileReference; explicitFileType = wrapper.application; path = Journey.app; sourceTree = BUILT_PRODUCTS_DIR;')
testproduct=add('testproduct','isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = JourneyTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
testref=add('testref','isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = JourneyTests.swift; sourceTree = "<group>";')
testbuild=add('testbuild',f'isa = PBXBuildFile; fileRef = {testref};')
group=add('sources',f'isa = PBXGroup; children = {arr(refs+[plist,asset])}; path = Journey; sourceTree = "<group>";')
testgroup=add('tests',f'isa = PBXGroup; children = {arr([testref])}; path = JourneyTests; sourceTree = "<group>";')
products=add('products',f'isa = PBXGroup; children = {arr([product,testproduct])}; name = Products; sourceTree = "<group>";')
main=add('main',f'isa = PBXGroup; children = {arr([group,testgroup,products])}; sourceTree = "<group>";')
sources=add('sourcesphase',f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {arr(builds)}; runOnlyForDeploymentPostprocessing = 0;')
resources=add('resourcesphase',f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = {arr([assetbuild])}; runOnlyForDeploymentPostprocessing = 0;')
frameworks=add('frameworks','isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
testsources=add('testsources',f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {arr([testbuild])}; runOnlyForDeploymentPostprocessing = 0;')
common='CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SDKROOT = iphoneos; TARGETED_DEVICE_FAMILY = "1,2";'
projectconfigs=[]; appconfigs=[]; testconfigs=[]
for name in ['Debug','Release']:
 projectconfigs.append(add('project'+name,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ {common} SWIFT_OPTIMIZATION_LEVEL = "'+('-Onone' if name=='Debug' else '-O')+'"; DEBUG_INFORMATION_FORMAT = dwarf; };'))
 appconfigs.append(add('app'+name,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ PRODUCT_NAME = Journey; PRODUCT_BUNDLE_IDENTIFIER = wang.jscloud.journey.ios; INFOPLIST_FILE = Journey/Info.plist; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; SWIFT_EMIT_LOC_STRINGS = YES; ENABLE_TESTABILITY = YES; SWIFT_ACTIVE_COMPILATION_CONDITIONS = "'+('DEBUG' if name=='Debug' else '')+'"; };'))
 testconfigs.append(add('test'+name,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ GENERATE_INFOPLIST_FILE = YES; PRODUCT_NAME = JourneyTests; PRODUCT_BUNDLE_IDENTIFIER = wang.jscloud.journey.ios.tests; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Journey.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Journey"; BUNDLE_LOADER = "$(TEST_HOST)"; CODE_SIGN_STYLE = Automatic; }};'))
def config(name,items): return add(name,f'isa = XCConfigurationList; buildConfigurations = {arr(items)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
pc=config('pc',projectconfigs); ac=config('ac',appconfigs); tc=config('tc',testconfigs)
target=add('target',f'isa = PBXNativeTarget; buildConfigurationList = {ac}; buildPhases = {arr([sources,frameworks,resources])}; buildRules = (); dependencies = (); name = Journey; productName = Journey; productReference = {product}; productType = "com.apple.product-type.application";')
proxy=add('proxy',f'isa = PBXContainerItemProxy; containerPortal = {uid("project")}; proxyType = 1; remoteGlobalIDString = {target}; remoteInfo = Journey;')
dep=add('dep',f'isa = PBXTargetDependency; target = {target}; targetProxy = {proxy};')
testtarget=add('testtarget',f'isa = PBXNativeTarget; buildConfigurationList = {tc}; buildPhases = {arr([testsources])}; buildRules = (); dependencies = {arr([dep])}; name = JourneyTests; productName = JourneyTests; productReference = {testproduct}; productType = "com.apple.product-type.bundle.unit-test";')
uiref=add('uiref','isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = JourneyUITests/JourneyUITests.swift; sourceTree = "<group>";')
uibuild=add('uibuild',f'isa = PBXBuildFile; fileRef = {uiref};')
objects[main]=objects[main].replace(arr([group,testgroup,products]),arr([group,testgroup,uiref,products]))
uiproduct=add('uiproduct','isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = JourneyUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
objects[products]=objects[products].replace(arr([product,testproduct]),arr([product,testproduct,uiproduct]))
uisources=add('uisources',f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {arr([uibuild])}; runOnlyForDeploymentPostprocessing = 0;')
uiconfigs=[]
for name in ['Debug','Release']:
 uiconfigs.append(add('ui'+name,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ GENERATE_INFOPLIST_FILE = YES; PRODUCT_NAME = JourneyUITests; PRODUCT_BUNDLE_IDENTIFIER = wang.jscloud.journey.ios.uitests; TEST_TARGET_NAME = Journey; CODE_SIGN_STYLE = Automatic; }};'))
uic=config('uic',uiconfigs)
uitarget=add('uitarget',f'isa = PBXNativeTarget; buildConfigurationList = {uic}; buildPhases = {arr([uisources])}; buildRules = (); dependencies = {arr([dep])}; name = JourneyUITests; productName = JourneyUITests; productReference = {uiproduct}; productType = "com.apple.product-type.bundle.ui-testing";')
project=add('project',f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; TargetAttributes = {{ {testtarget} = {{ TestTargetID = {target}; }}; }}; }}; buildConfigurationList = {pc}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh-Hans; hasScannedForEncodings = 0; knownRegions = (en, "zh-Hans", Base); mainGroup = {main}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = {arr([target,testtarget,uitarget])};')
(root/'Journey.xcodeproj'/'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+''.join(f'{k} = {{ {v} }};\n' for k,v in objects.items())+f'}}; rootObject = {project}; }}\n')
scheme=f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Journey.app" BlueprintName="Journey" ReferencedContainer="container:Journey.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{testtarget}" BuildableName="JourneyTests.xctest" BlueprintName="JourneyTests" ReferencedContainer="container:Journey.xcodeproj"/></TestableReference><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uitarget}" BuildableName="JourneyUITests.xctest" BlueprintName="JourneyUITests" ReferencedContainer="container:Journey.xcodeproj"/></TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Journey.app" BlueprintName="Journey" ReferencedContainer="container:Journey.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugServiceExtension="internal"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>'''
(root/'Journey.xcodeproj/xcshareddata/xcschemes/Journey.xcscheme').write_text(scheme)
