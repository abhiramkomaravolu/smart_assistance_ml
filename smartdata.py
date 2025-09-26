import sys
import pickle
import json

# Load the models from Pickle files
with open("smartttdata_alert_model.pkl", "rb") as f:
    alert_model = pickle.load(f)

# Extract features from command-line arguments
form_data = json.loads(sys.argv[1])
age = form_data.get('age')
trestbps = form_data.get('trestbps')
chol = form_data.get('chol')
thalch = form_data.get('thalch')
sex = form_data.get('sex')
cp = form_data.get('cp')

if sex == "male":
    sex_Female = 0
    sex_Male = 1
else:
    sex_Female = 1
    sex_Male = 0

# Map cp to individual variables
if cp == "asymptomatic":
    cp_asymptomatic = 1
    cp_atypical_angina = 0
    cp_non_anginal = 0
    cp_typical_angina = 0
elif cp == "atypical-angina":
    cp_asymptomatic = 0
    cp_atypical_angina = 1
    cp_non_anginal = 0
    cp_typical_angina = 0
elif cp == "non-anginal":
    cp_asymptomatic = 0
    cp_atypical_angina = 0
    cp_non_anginal = 1
    cp_typical_angina = 0
else:
    cp_asymptomatic = 0
    cp_atypical_angina = 0
    cp_non_anginal = 0
    cp_typical_angina = 1

# Make predictions using the loaded models
alert_prediction = alert_model.predict([[age, trestbps, chol, thalch, sex_Female, sex_Male, cp_asymptomatic, cp_atypical_angina, cp_non_anginal, cp_typical_angina]])[0]

# Print the predictions as a JSON object
alert_prediction = str(alert_prediction)
print(json.dumps({'alert_prediction': alert_prediction}))
