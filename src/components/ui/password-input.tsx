/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useState } from "react";

import { useTheme } from "@/hooks/use-theme";
import type { BorderStyle } from "@/components/ui/types";

export interface PasswordInputProps {
    value?: string;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    mask?: string;
    showToggle?: boolean;
    label?: string;
    /** Renders as the border title (single-line, like a titled box). Takes
     * precedence over `label` and hides the inline toggle hint. */
    title?: string;
    id?: string;
    borderStyle?: BorderStyle;
    paddingX?: number;
    width?: number;
    cursor?: string;
    /** When false the global key handler ignores input (multi-field forms). */
    focused?: boolean;
}

/** termcn OpenTUI password-input, adapted with a `focused` gate so it can
 * share the screen with the username field on the auth form. */
export const PasswordInput = ({
    value: controlledValue,
    onChange,
    onSubmit,
    placeholder = "",
    mask = "●",
    showToggle = false,
    label,
    title,
    id: _id,
    borderStyle = "rounded",
    paddingX = 1,
    width,
    cursor = "█",
    focused = true,
}: PasswordInputProps) => {
    const [internalValue, setInternalValue] = useState("");
    const [isVisible, setIsVisible] = useState(false);
    const theme = useTheme();

    void _id;

    const value = controlledValue ?? internalValue;

    const setValue = (newVal: string) => {
        if (onChange) {
            onChange(newVal);
        } else {
            setInternalValue(newVal);
        }
    };

    useKeyboard((key) => {
        if (!focused) {
            return;
        }
        if (showToggle && key.ctrl && key.name === "h") {
            setIsVisible((v) => !v);
            return;
        }
        if (key.name === "return") {
            onSubmit?.(value);
            return;
        }
        if (key.name === "backspace" || key.name === "delete") {
            setValue(value.slice(0, -1));
            return;
        }
        if (key.name === "escape" || key.name === "up" || key.name === "down" || key.name === "tab") {
            return;
        }
        if (key.name && key.name.length === 1) {
            setValue(value + key.name);
        }
    });

    const displayValue = isVisible ? value : mask.repeat(value.length);
    const borderColor = focused ? theme.colors.focusRing : theme.colors.border;

    return (
        <box flexDirection="column">
            {label && !title && (
                <text>
                    <b>{label}</b>
                </text>
            )}
            <box flexDirection="row" alignItems="center" gap={1}>
                <box
                    border
                    title={title}
                    borderStyle={borderStyle}
                    borderColor={borderColor}
                    paddingLeft={paddingX}
                    paddingRight={paddingX}
                    width={width}
                >
                    <text fg={value ? theme.colors.foreground : theme.colors.mutedForeground}>
                        {displayValue || placeholder}
                    </text>
                    {focused && <text fg={theme.colors.focusRing}>{cursor}</text>}
                </box>
                {showToggle && focused && !title && (
                    <text fg={theme.colors.mutedForeground}>{isVisible ? "Ctrl+H hide" : "Ctrl+H show"}</text>
                )}
            </box>
        </box>
    );
};
