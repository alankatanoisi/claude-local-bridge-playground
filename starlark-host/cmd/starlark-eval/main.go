// Command starlark-eval is a deliberately small JSON-in/JSON-out boundary.
//
// The Node control plane sends a Starlark program, a function name, and a JSON
// context. This process evaluates the function without exposing filesystem,
// network, environment, clock, or shell functions to the Starlark program.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"go.starlark.net/starlark"
)

type request struct {
	Source    string `json:"source"`
	Function  string `json:"function"`
	Context   any    `json:"context"`
	MaxSteps  uint64 `json:"max_steps"`
	TimeoutMS int    `json:"timeout_ms"`
}

type response struct {
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
	Steps  uint64 `json:"steps"`
}

func main() {
	var req request
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&req); err != nil {
		writeResponse(response{OK: false, Error: "invalid request JSON: " + err.Error()})
		return
	}

	result, steps, err := evaluate(req)
	if err != nil {
		writeResponse(response{OK: false, Error: err.Error(), Steps: steps})
		return
	}

	writeResponse(response{OK: true, Result: result, Steps: steps})
}

func evaluate(req request) (any, uint64, error) {
	if req.Source == "" {
		return nil, 0, errors.New("source must not be empty")
	}
	if req.Function == "" {
		return nil, 0, errors.New("function must not be empty")
	}
	if req.MaxSteps == 0 {
		req.MaxSteps = 200_000
	}
	if req.TimeoutMS <= 0 {
		req.TimeoutMS = 2_000
	}

	thread := &starlark.Thread{
		Name: "generated-plan",
		// A load statement is rejected because the prototype exposes no loader.
		Load: func(_ *starlark.Thread, module string) (starlark.StringDict, error) {
			return nil, fmt.Errorf("load is disabled: %s", module)
		},
		// Print goes to stderr so stdout remains one machine-readable JSON object.
		Print: func(_ *starlark.Thread, message string) {
			fmt.Fprintln(os.Stderr, "starlark print:", message)
		},
	}
	thread.SetMaxExecutionSteps(req.MaxSteps)

	// Cancellation is a second guard beside the deterministic step ceiling.
	// The timer cannot forcibly stop a blocking host function, but this evaluator
	// deliberately exposes no host functions that can block.
	timer := time.AfterFunc(time.Duration(req.TimeoutMS)*time.Millisecond, func() {
		thread.Cancel("Starlark execution timed out")
	})
	defer timer.Stop()

	globals, err := starlark.ExecFile(thread, "generated.star", req.Source, nil)
	if err != nil {
		return nil, thread.ExecutionSteps(), fmt.Errorf("Starlark module failed: %w", err)
	}

	callable, ok := globals[req.Function]
	if !ok {
		return nil, thread.ExecutionSteps(), fmt.Errorf("function %q was not defined", req.Function)
	}
	if _, ok := callable.(starlark.Callable); !ok {
		return nil, thread.ExecutionSteps(), fmt.Errorf("%q is not callable", req.Function)
	}

	ctx, err := toStarlark(req.Context)
	if err != nil {
		return nil, thread.ExecutionSteps(), fmt.Errorf("context conversion failed: %w", err)
	}
	value, err := starlark.Call(thread, callable, starlark.Tuple{ctx}, nil)
	if err != nil {
		return nil, thread.ExecutionSteps(), fmt.Errorf("Starlark function failed: %w", err)
	}

	result, err := fromStarlark(value)
	if err != nil {
		return nil, thread.ExecutionSteps(), fmt.Errorf("result conversion failed: %w", err)
	}
	return result, thread.ExecutionSteps(), nil
}

func toStarlark(input any) (starlark.Value, error) {
	switch value := input.(type) {
	case nil:
		return starlark.None, nil
	case bool:
		return starlark.Bool(value), nil
	case string:
		return starlark.String(value), nil
	case float64:
		if value == float64(int64(value)) {
			return starlark.MakeInt64(int64(value)), nil
		}
		return starlark.Float(value), nil
	case []any:
		items := make([]starlark.Value, 0, len(value))
		for _, item := range value {
			converted, err := toStarlark(item)
			if err != nil {
				return nil, err
			}
			items = append(items, converted)
		}
		return starlark.NewList(items), nil
	case map[string]any:
		dict := starlark.NewDict(len(value))
		for key, item := range value {
			converted, err := toStarlark(item)
			if err != nil {
				return nil, err
			}
			if err := dict.SetKey(starlark.String(key), converted); err != nil {
				return nil, err
			}
		}
		return dict, nil
	default:
		return nil, fmt.Errorf("unsupported JSON value %T", input)
	}
}

func fromStarlark(value starlark.Value) (any, error) {
	switch value := value.(type) {
	case starlark.NoneType:
		return nil, nil
	case starlark.Bool:
		return bool(value), nil
	case starlark.String:
		return string(value), nil
	case starlark.Int:
		integer, ok := value.Int64()
		if !ok {
			return nil, errors.New("integer does not fit in signed 64 bits")
		}
		return integer, nil
	case starlark.Float:
		return float64(value), nil
	case *starlark.List:
		items := make([]any, 0, value.Len())
		iterator := value.Iterate()
		defer iterator.Done()
		var item starlark.Value
		for iterator.Next(&item) {
			converted, err := fromStarlark(item)
			if err != nil {
				return nil, err
			}
			items = append(items, converted)
		}
		return items, nil
	case starlark.Tuple:
		items := make([]any, 0, len(value))
		for _, item := range value {
			converted, err := fromStarlark(item)
			if err != nil {
				return nil, err
			}
			items = append(items, converted)
		}
		return items, nil
	case *starlark.Dict:
		result := make(map[string]any, value.Len())
		for _, item := range value.Items() {
			key, ok := starlark.AsString(item[0])
			if !ok {
				return nil, errors.New("result dictionaries must use string keys")
			}
			converted, err := fromStarlark(item[1])
			if err != nil {
				return nil, err
			}
			result[key] = converted
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported result type %s", value.Type())
	}
}

func writeResponse(result response) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "failed to encode response:", err)
		os.Exit(1)
	}
}
