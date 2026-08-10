# This program expands only host-approved values. It cannot invent a workflow,
# model, fault profile, provider, credential, command, path, or budget.
def matrix(ctx):
    cases = []
    for workflow in ctx["workflows"]:
        for control_model in ctx["control_models"]:
            for fault_profile in ctx["fault_profiles"]:
                for repetition in range(ctx["repetitions"]):
                    cases.append({
                        "id": workflow + "__" + control_model + "__" + fault_profile + "__r" + str(repetition + 1),
                        "workflow": workflow,
                        "control_model": control_model,
                        "fault_profile": fault_profile,
                        "repetition": repetition + 1,
                    })
    return cases
