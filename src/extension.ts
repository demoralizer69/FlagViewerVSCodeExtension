import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { transformText, getProcessedOutput} from './textTransformer';
import DynamicFlagViewProvider from './dynamicFlagViewProvider';
import { openVSCodeCompareBetweenTexts, openVSCodeCompareBetweenUris } from './vscodeCompareUtils';

/**
 * Scan a file text to find all flags in the file
 * @param text Text of the entire document
 * @returns array of flags present in the file
 */
const scanFlagsFromText = (text : string) : string[] => {
	let flagsArr : string[] = [];
	let pos = 0;
	while(pos !== -1){
		pos = text.indexOf("defined(", pos);
		if(pos === -1){
			break;
		}
		pos = pos + "defined(".length;
		let end = text.indexOf(")", pos);
		if(end === -1){
			break;
		}
		flagsArr = [...flagsArr, text.slice(pos, end)];
		pos = end;
	}
	return [...new Set(flagsArr)];
};

// use input boxes to take flags from input
const getFlagsFromInput = async (scannedFlags : string[]) : Promise<string[]> => {
	const flagPickerInput = await vscode.window.showQuickPick(
		scannedFlags, {
			ignoreFocusOut : true,
			canPickMany : true,
			title : "FlagViewer",
			placeHolder: "Choose relevant flags from the list and press Enter",
		},
	);
	if(flagPickerInput === undefined){
		return undefined as unknown as string[];
	}
	// const extraFlagsInput = await vscode.window.showInputBox({
	// 	ignoreFocusOut: true,
	// 	placeHolder: "(ex: FLAG_A,FLAG_B)",
	// 	prompt: "Write a list of comma-separated flags not in the previous list",
	// 	title : "FlagViewer",
	// });
	// if(extraFlagsInput === undefined){
	// 	return undefined as unknown as string[];
	// }
	// const flagsArr = extraFlagsInput
	// 					.split(',')
	// 					.filter((e) => e !== '')
	// 					.concat(flagPickerInput)
	const flagsArr = flagPickerInput
						.map((e) => `-D${e}`);
	return flagsArr;
};

const getGitRevisionFromInput = async (fileUri : vscode.Uri) : Promise<string> => {
	const fileDir = fileUri.path.split('/').slice(0,-1).join('/');

	const child = spawn(
		'git',
		['rev-list', '--all', '--pretty=oneline', '--abbrev=40'],
		{cwd : fileDir},
	);
	const gitRefs = (await new Response(child.stdout).text()).split('\n');
	const pickedItem = await vscode.window.showQuickPick(
		['HEAD', ...gitRefs], {
			title : "FlagViewer",
			placeHolder: "Choose a git revision to compare with",
		},
	);
	if(pickedItem === undefined){
		return undefined as unknown as string;
	}
	const chosenGitRef = pickedItem.slice(0,40);
	return chosenGitRef;
};

const getFileTextFromRevision = async (gitRef : string, fileUri : vscode.Uri) : Promise<string> => {
	const fileDir = fileUri.path.split('/').slice(0,-1).join('/');
	const fileName = fileUri.path.split('/').at(-1);
	const child = spawn(
		'git',
		['show', `${gitRef}:./${fileName}`],
		{cwd : fileDir},
	);
	return new Response(child.stdout).text();
};

// expandDefines -> true/false
const viewWithFlagsCommandHandler = async (context : vscode.ExtensionContext, expandDefines : boolean) => {
	// --- get file text from the active editor ---
	const editor = vscode.window.activeTextEditor;
	if(editor === undefined){
		return;
	}
	const docUri = editor.document.uri;
	const transformedText = transformText(editor.document.getText(), expandDefines);

	// --- get flags from input boxes ---
	const flagsArr = await getFlagsFromInput(scanFlagsFromText(transformedText));
	if(flagsArr === undefined){
		return;
	}

	openVSCodeCompareBetweenUris(
		docUri,
		DynamicFlagViewProvider.encode(docUri, flagsArr, expandDefines),
		docUri.path.split('/').at(-1)
	);
};

const viewGitDiffWithFlagsCommandHandler = async (context : vscode.ExtensionContext, expandDefines : boolean) => {
	// --- get file text from the active editor ---
	const editor = vscode.window.activeTextEditor;
	if(editor === undefined){
		return;
	}
	const docUri = editor.document.uri;
	const transformedText = transformText(editor.document.getText(), expandDefines);

	// --- get git hash from input ---
	const gitRef = await getGitRevisionFromInput(docUri);
	if(gitRef === undefined){
		return;
	}
	const oldFileText = await getFileTextFromRevision(gitRef, docUri);
	const transformedOldText = transformText(oldFileText, expandDefines);
	const flagsArr = await getFlagsFromInput(scanFlagsFromText(transformedText));
	const processedText = await getProcessedOutput(transformedText, flagsArr, expandDefines);
	const processedOldText = await getProcessedOutput(transformedOldText, flagsArr, expandDefines);
	openVSCodeCompareBetweenTexts(context, docUri, processedText, processedOldText);
};

// this function is called when the extension is initially activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "flagviewer" is now active!');

	const providerDisposable = new DynamicFlagViewProvider();
	const providerRegistrationDisposable = vscode.workspace.registerTextDocumentContentProvider(
		DynamicFlagViewProvider.scheme,
		providerDisposable,
	);

	const viewWithFlagsDisposable = vscode.commands.registerCommand(
		'flagviewer.viewWithFlags',
		async () => viewWithFlagsCommandHandler(context, false),
	);

	const viewWithFlagsExpandDefinesDisposable = vscode.commands.registerCommand(
		'flagviewer.viewWithFlagsExpandDefines',
		async () => viewWithFlagsCommandHandler(context, true),
	);

	const viewGitDiffWithFlagsDisposable = vscode.commands.registerCommand(
		'flagviewer.viewGitDiffWithFlags',
		async () => viewGitDiffWithFlagsCommandHandler(context, true),
	);

	context.subscriptions.push(
		providerDisposable,
		providerRegistrationDisposable,
		viewWithFlagsDisposable,
		viewWithFlagsExpandDefinesDisposable,
		viewGitDiffWithFlagsDisposable,
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
