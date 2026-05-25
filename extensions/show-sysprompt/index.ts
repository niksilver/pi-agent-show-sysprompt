import type { ExtensionAPI, Theme, ToolInfo } from "@mariozechner/pi-coding-agent"
import { Box, Text } from "@mariozechner/pi-tui"
import type { TArray, TEnum, TLiteral, TObject, TSchema, TSchemaOptions, TUnion } from "typebox"


const SYSTEM_PROMPT_MESSAGE_TYPE = "system-prompt"
const TOOL_SCHEMAS_MESSAGE_TYPE = "tool-schemas"
const HIDDEN_MESSAGE_TYPES = new Set([SYSTEM_PROMPT_MESSAGE_TYPE, TOOL_SCHEMAS_MESSAGE_TYPE])

let showEnabled = false

type DescribedSchema = TSchema & Pick<TSchemaOptions, "description">
type ToolParameters = TObject<Record<string, DescribedSchema>> & { required?: string[] }

function formatCollapsibleMessage(title: string, content: string, expanded: boolean, theme: Theme) {
	const lineCount = content.length === 0 ? 0 : content.split("\n").length
	const header = expanded
		? `${theme.fg("accent", theme.bold(title))}${theme.fg("dim", " (Ctrl+o to collapse)")}`
		: `${theme.fg("accent", theme.bold(title))}${theme.fg("dim", ` (${lineCount} lines, Ctrl+o to expand)`)}`
	const text = expanded ? `${header}\n\n${content}` : header
	const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
	box.addChild(new Text(text, 0, 0))
	return box
}

function formatSchemaType(schema: TSchema | undefined): string {
	if (!schema) return "any"
	if ("const" in schema) return JSON.stringify((schema as TLiteral).const)
	if ("enum" in schema) return (schema as TEnum).enum.map(value => JSON.stringify(value)).join(" | ")
	if ("anyOf" in schema) return (schema as TUnion).anyOf.map(formatSchemaType).join(" | ")
	if ("oneOf" in schema) return (schema as TSchema & { oneOf: TSchema[] }).oneOf.map(formatSchemaType).join(" | ")
	if ("items" in schema) return `${formatSchemaType((schema as TArray).items)}[]`
	if ("type" in schema) {
		const type = (schema as TSchema & { type: string | string[] }).type
		return Array.isArray(type) ? type.join(" | ") : type
	}
	return "any"
}

function formatToolSchemas(tools: ToolInfo[]): string {
	if (tools.length === 0) return "No active tools."

	return tools
		.map(tool => {
			const parameters = tool.parameters as Partial<ToolParameters>
			const properties = parameters.properties ?? {}
			const required = new Set(parameters.required ?? [])
			const parameterNames = Object.keys(properties)
			const header = `${tool.name} - ${tool.description}`
			if (parameterNames.length === 0) return `${header}\n  (no parameters)`

			const params = parameterNames
				.map(name => {
					const property = properties[name]
					const presence = required.has(name) ? "required" : "optional"
					const type = formatSchemaType(property)
					const description = property?.description ? ` - ${property.description}` : ""
					return `  ${name}: ${type} [${presence}]${description}`
				})
				.join("\n")

			return `${header}\n${params}`
		})
		.join("\n\n")
}


function showPromptAndTools(pi: ExtensionAPI, ctx: any) {
	const shownMessageTypes = new Set(
		ctx.sessionManager
			.getBranch()
			.filter(entry => entry.type === "custom_message" && "customType" in entry && HIDDEN_MESSAGE_TYPES.has(entry.customType))
			.map(entry => ("customType" in entry ? entry.customType : ""))
	)

	if (!shownMessageTypes.has(SYSTEM_PROMPT_MESSAGE_TYPE)) {
		pi.sendMessage({
			customType: SYSTEM_PROMPT_MESSAGE_TYPE,
			content: ctx.getSystemPrompt(),
			display: true
		})
	}

	if (!shownMessageTypes.has(TOOL_SCHEMAS_MESSAGE_TYPE)) {
		const activeTools = new Set(pi.getActiveTools())
		pi.sendMessage({
			customType: TOOL_SCHEMAS_MESSAGE_TYPE,
			content: formatToolSchemas(pi.getAllTools().filter(tool => activeTools.has(tool.name))),
			display: true
		})
	}
}

export default function showSyspromptExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(SYSTEM_PROMPT_MESSAGE_TYPE, (message, { expanded }, theme) => {
		const prompt = typeof message.content === "string" ? message.content : ""
		return formatCollapsibleMessage("System prompt", prompt, expanded, theme)
	})

	pi.registerMessageRenderer(TOOL_SCHEMAS_MESSAGE_TYPE, (message, { expanded }, theme) => {
		const schemas = typeof message.content === "string" ? message.content : ""
		return formatCollapsibleMessage("Available tools", schemas, expanded, theme)
	})

	pi.registerCommand("show-sysprompt", {
		description: "Show system prompt and active tool schemas [on|off]",
		handler: async (args, ctx) => {
			const action = args?.toLowerCase()
			if (action === "on") {
				showEnabled = true
				showPromptAndTools(pi, ctx)
				ctx.ui.notify("System prompt and tool schemas enabled", "info")
			} else if (action === "off") {
				showEnabled = false
				ctx.ui.notify("System prompt and tool schemas disabled", "info")
			} else {
				ctx.ui.notify("Usage: /show-sysprompt [on|off]", "error")
			}
		}
	})

	pi.on("agent_start", (_event, ctx) => {
		if (showEnabled) {
			showPromptAndTools(pi, ctx)
		}
	})

	pi.on("session_before_tree", (event, ctx) => {
		const entry = ctx.sessionManager.getEntry(event.preparation.targetId)
		if (entry?.type === "custom_message" && HIDDEN_MESSAGE_TYPES.has(entry.customType)) return { cancel: true }
	})

	pi.on("context", event => ({
		messages: event.messages.filter(
			message => !(message.role === "custom" && "customType" in message && HIDDEN_MESSAGE_TYPES.has(message.customType))
		)
	}))
}
