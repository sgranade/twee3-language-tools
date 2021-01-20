import * as vscode from "vscode";

import * as socketio from 'socket.io';

import { Passage } from './tree-view';

export async function getPassageContent(passage: Passage): Promise<string> {
	const doc = await vscode.workspace.openTextDocument(passage.origin);
	const fileContent = doc.getText();
	const searchPassageRegexp = new RegExp("^::\\s*" + passage.name.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&") + ".*?$", "m");
	const anyPassageRegexp = new RegExp("^::\s*(.*)?(\[.*?\]\s*?)?(\{.*\}\s*)?$", "m");
	const passageStartMatch = fileContent.match(searchPassageRegexp);
	if (!passageStartMatch || !('index' in passageStartMatch)) throw new Error('Cannot find passage title in origin-file');
	const contentStart = (passageStartMatch.index as number) + passageStartMatch[0].length;
	const restOfFile = fileContent.substr(contentStart);
	const nextPassageMatch = restOfFile.match(anyPassageRegexp);
	return restOfFile.substr(0, nextPassageMatch?.index);
}

export async function getLinkedPassageNames(passage: Passage): Promise<string[]> {
	const passageContent = await getPassageContent(passage);
	const parts = passageContent.split(/\[(?:img)?\[/).slice(1);
	return parts.filter((part) => part.indexOf(']]') !== -1).map((part) => {
		const link = part.split(']').shift() as string;
		if (link.includes("->")) return (link.split("->").pop() as string).trim();
		else if (link.includes("<-")) return (link.split("<-").shift() as string).trim();
		else return (link.split('|').pop() as string).trim();
	});
};

export async function sendPassagesToClient(ctx: vscode.ExtensionContext, client: socketio.Socket) {
	const rawPassages = ctx.workspaceState.get("passages", []) as Passage[];
	const passagePromises = rawPassages.map(async (passage) => {
		const linksToNames = await getLinkedPassageNames(passage);
		return {
			origin: passage.origin,
			name: passage.name,
			tags: passage.tags,
			meta: passage.meta,
			linksToNames,
		};
	});
	const passages = await Promise.all(passagePromises);
	console.log(`Sending ${passages.length} passages to client`);
	client.emit('passages', passages);
}

export type Vector = { x: number; y: number; };
export type UpdatePassage = { name: string; origin: string; position: Vector; size: Vector; tags?: string[] };

export async function updatePassages(passages: UpdatePassage[]) {
	const files = [... new Set(passages.map(passage => passage.origin))];
	for (const file of files) {
		const doc = await vscode.workspace.openTextDocument(file);
		await doc.save();
		let edited = doc.getText();

		const filePassages = passages.filter(el => el.origin === file);
		for (const passage of filePassages) {
			const regexp = new RegExp(
				"^::\\s*" +
				passage.name.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&") +
				".*?$"
			, "m");

			let pMeta: any = { position: `${passage.position.x},${passage.position.y}` };
			if (passage.size.x !== 100 || passage.size.y !== 100) pMeta.size = `${passage.size.x},${passage.size.y}`;

			edited = edited.replace(regexp, `:: ${passage.name} ` + (passage.tags?.length ? `[${passage.tags.join(" ")}] ` : "") + JSON.stringify(pMeta));
		}

		await vscode.workspace.fs.writeFile(doc.uri, Buffer.from(edited));
	}
}