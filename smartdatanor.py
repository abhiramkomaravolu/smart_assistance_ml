import sys
import pickle
import json

# Load the models from Pickle files
with open("smartttdatanor_alert_model.pkl", "rb") as f:
    alert_model = pickle.load(f)

# Extract features from command-line arguments
form_data = json.loads(sys.argv[1])
age = form_data.get('age')
trestbps = form_data.get('trestbps')
thalch = form_data.get('thalch')
sex = form_data.get('sex')


if sex == "male":
    sex_Female = 0
    sex_Male = 1
else:
    sex_Female = 1
    sex_Male = 0


# Make predictions using the loaded models
alert_prediction = alert_model.predict([[age, trestbps, thalch, sex_Female, sex_Male]])[0]

# Print the predictions as a JSON object
alert_prediction = str(alert_prediction)
print(json.dumps({'alert_prediction': alert_prediction}))
