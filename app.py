import streamlit as st

# Assuming data_sources.py is in the same directory
from data_sources import *

# Streamlit app
st.title('Streamlit Application')

# Example usage of data sources
if st.button('Load Data'):
    data = my_data_source.load_data()  # Update with your actual data source method
    st.write(data)